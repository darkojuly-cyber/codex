import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Queryable } from '../../db/src.js';
import { AppError, type Actor } from './config.js';
import { xpConfigSchema, xpDefaults, evoPointsProposal, periodStart, xpEvents, type XpConfig, type XpEvent, type XpRule, type XpPeriod } from './xp-config.js';

type Row = Record<string, unknown>;
export type XpRevision = { id: string; version: number; status: string; body: XpConfig; published_at: Date | string | null; base_version: number | null; edit_version: number };
type Award = { user: string; event: XpEvent; source: string; occurredAt: Date; actor: string; reason: string; channel?: string; hash?: string };
const userId = z.string().regex(/^\d{17,20}$/);
const sourceId = z.string().regex(/^[a-zA-Z0-9:_-]{5,120}$/);
const thirtyDays = 30 * 86400000;

export class XpService {
  constructor(readonly db: Database, readonly participant?: (user: string) => Promise<{ canEarn: boolean; canRank: boolean }>) {}
  async refreshParticipant(user: string, force = false) {
    if (!this.participant) return { canEarn: true, canRank: true };
    const [cached] = await this.db.query("SELECT can_earn,can_rank FROM xp_participant WHERE user_id=$1 AND checked_at>now()-interval '30 seconds'", [user]);
    if (cached && !force) return { canEarn: cached.can_earn === true, canRank: cached.can_rank === true };
    let participation: { canEarn: boolean; canRank: boolean };
    try { participation = await this.participant(user); }
    catch { throw new AppError(503, 'XP_ELIGIBILITY_UNAVAILABLE'); }
    await this.db.query('INSERT INTO xp_participant(user_id,can_earn,can_rank) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET can_earn=$2,can_rank=$3,checked_at=now()', [user, participation.canEarn, participation.canRank]);
    return participation;
  }
  async invalidateParticipants() {
    await this.db.query("UPDATE xp_participant SET checked_at='1970-01-01' WHERE checked_at>'1970-01-01'");
  }
  private async refreshParticipants() {
    if (!this.participant) return;
    const users = await this.db.query("SELECT DISTINCT l.user_id FROM xp_ledger l LEFT JOIN xp_participant p ON p.user_id=l.user_id WHERE p.checked_at IS NULL OR p.checked_at<=now()-interval '30 seconds'");
    for (let i = 0; i < users.length; i += 5) await Promise.all(users.slice(i, i + 5).map(row => this.refreshParticipant(String(row.user_id))));
  }
  requireManager(actor: Actor) {
    if (!['SUPER_ADMIN', 'COMMUNITY_MANAGER'].includes(actor.role)) throw new AppError(403, 'FORBIDDEN');
  }
  private async audit(tx: Queryable, actor: string, action: string, entity: string, detail: Row = {}) {
    await tx.query('INSERT INTO audit_log(id,actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor, action, entity, JSON.stringify(detail)]);
  }
  async initialize() {
    await this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_rule_revision IN EXCLUSIVE MODE');
      if (!(await tx.query('SELECT id FROM xp_rule_revision LIMIT 1')).length) {
        await tx.query("INSERT INTO xp_rule_revision(id,status,body,reason,authored_by,approved_by,published_by,published_at) VALUES($1,'PUBLISHED',$2,$3,'system','system','system',now())", [randomUUID(), JSON.stringify(xpDefaults), 'Disabled proposal; scoring requires reviewed rules and explicit publication.']);
      }
    });
  }
  async current(tx: Queryable = this.db): Promise<XpRevision> {
    const [revision] = await tx.query('SELECT * FROM xp_rule_revision WHERE status=\'PUBLISHED\'');
    if (!revision) throw new AppError(503, 'XP_NOT_INITIALIZED');
    return revision as unknown as XpRevision;
  }
  async configuration(actor: Actor) {
    this.requireManager(actor);
    return { current: await this.current(), revisions: await this.db.query('SELECT * FROM xp_rule_revision ORDER BY version DESC LIMIT 50'), ledger: await this.db.query('SELECT * FROM xp_ledger ORDER BY created_at DESC,id DESC LIMIT 100'), boosts: await this.db.query('SELECT * FROM xp_boost_state ORDER BY verified_at DESC LIMIT 100') };
  }
  async draft(actor: Actor, input: unknown) {
    this.requireManager(actor);
    const data = z.object({ config: xpConfigSchema, reason: z.string().trim().min(5).max(500), expectedVersion: z.number().int().positive().optional() }).strict().parse(input);
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_rule_revision IN EXCLUSIVE MODE');
      const current = await this.current(tx);
      if (data.expectedVersion !== undefined && data.expectedVersion !== current.version) throw new AppError(409, 'XP_CONFIG_CHANGED');
      const [row] = await tx.query("INSERT INTO xp_rule_revision(id,status,body,reason,authored_by,base_version) VALUES($1,'DRAFT',$2,$3,$4,$5) RETURNING *", [randomUUID(), JSON.stringify(data.config), data.reason, actor.id, current.version]);
      await this.audit(tx, actor.id, 'xp.rules_drafted', String(row.id));
      return row;
    });
  }
  async proposal(actor: Actor) {
    this.requireManager(actor);
    const current = await this.current();
    return this.draft(actor, { config: evoPointsProposal(current.body), reason: 'Evo Points community preset — review before publication', expectedVersion: current.version });
  }
  private freshDraft(row: Row, current: XpRevision) {
    if (Number(row.base_version) !== current.version || Number(row.version) <= current.version) throw new AppError(409, 'XP_DRAFT_STALE');
  }
  async updateDraft(actor: Actor, id: string, input: unknown) {
    this.requireManager(actor);
    const data = z.object({ config: xpConfigSchema, reason: z.string().trim().min(5).max(500), expectedVersion: z.number().int().positive(), expectedEditVersion: z.number().int().positive() }).strict().parse(input);
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_rule_revision IN EXCLUSIVE MODE');
      const current = await this.current(tx);
      if (current.version !== data.expectedVersion) throw new AppError(409, 'XP_CONFIG_CHANGED');
      const [old] = await tx.query("SELECT * FROM xp_rule_revision WHERE id=$1 AND status IN ('DRAFT','APPROVED')", [id]);
      if (!old) throw new AppError(409, 'XP_DRAFT_NOT_FOUND');
      this.freshDraft(old, current);
      if (Number(old.edit_version) !== data.expectedEditVersion) throw new AppError(409, 'XP_DRAFT_CHANGED');
      const [row] = await tx.query("UPDATE xp_rule_revision SET body=$2,reason=$3,status='DRAFT',approved_by=NULL,approved_at=NULL,edit_version=edit_version+1 WHERE id=$1 RETURNING *", [id, JSON.stringify(data.config), data.reason]);
      await this.audit(tx, actor.id, 'xp.rules_updated', id, { editVersion: row.edit_version, approvalReset: old.status === 'APPROVED' });
      return row;
    });
  }
  async approve(actor: Actor, id: string, expectedEditVersion?: number) {
    this.requireManager(actor);
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_rule_revision IN EXCLUSIVE MODE');
      const current = await this.current(tx);
      const [draft] = await tx.query("SELECT * FROM xp_rule_revision WHERE id=$1 AND status='DRAFT'", [id]);
      if (!draft) throw new AppError(409, 'XP_DRAFT_NOT_FOUND');
      this.freshDraft(draft, current);
      if (expectedEditVersion !== undefined && Number(draft.edit_version) !== expectedEditVersion) throw new AppError(409, 'XP_DRAFT_CHANGED');
      const [row] = await tx.query("UPDATE xp_rule_revision SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1 AND status='DRAFT' RETURNING *", [id, actor.id]);
      if (!row) throw new AppError(409, 'XP_DRAFT_NOT_FOUND');
      await this.audit(tx, actor.id, 'xp.rules_approved', id);
      return row;
    });
  }
  async publish(actor: Actor, id: string, expectedVersion: number, expectedEditVersion?: number) {
    this.requireManager(actor);
    return this.db.transaction(async tx => {
      // Same lock order as awards. A changed rule never races a half-written award.
      await tx.query('LOCK TABLE xp_ledger IN EXCLUSIVE MODE');
      await tx.query('LOCK TABLE xp_rule_revision IN EXCLUSIVE MODE');
      const current = await this.current(tx);
      if (current.version !== expectedVersion) throw new AppError(409, 'XP_CONFIG_CHANGED');
      const [row] = await tx.query("SELECT * FROM xp_rule_revision WHERE id=$1 AND status='APPROVED'", [id]);
      if (!row) throw new AppError(409, 'XP_APPROVAL_REQUIRED');
      this.freshDraft(row, current);
      if (expectedEditVersion !== undefined && Number(row.edit_version) !== expectedEditVersion) throw new AppError(409, 'XP_DRAFT_CHANGED');
      xpConfigSchema.parse(row.body);
      await tx.query("UPDATE xp_rule_revision SET status='SUPERSEDED' WHERE status='PUBLISHED'");
      const [published] = await tx.query("UPDATE xp_rule_revision SET status='PUBLISHED',published_by=$2,published_at=now() WHERE id=$1 RETURNING *", [id, actor.id]);
      await this.audit(tx, actor.id, 'xp.rules_published', id, { from: current.version, to: published.version });
      return published;
    });
  }
  private async award(tx: Queryable, revision: XpRevision, rule: XpRule | undefined, data: Award) {
    const reject = (reason: string) => ({ awarded: false, reason, amount: 0 });
    const c = revision.body;
    const now = Date.now();
    if (!c.enabled || !rule?.enabled) return reject('XP_DISABLED');
    if (this.participant && !(await tx.query('SELECT user_id FROM xp_participant WHERE user_id=$1 AND can_earn=true', [data.user])).length) return reject('XP_MEMBER_NOT_ELIGIBLE');
    if (!Number.isFinite(data.occurredAt.getTime()) || data.occurredAt.getTime() > now + 5000 || data.occurredAt < new Date(revision.published_at!)) return reject('EVENT_OUTSIDE_RULE_VERSION');
    if ((rule.startsAt && data.occurredAt < new Date(rule.startsAt)) || (rule.endsAt && data.occurredAt >= new Date(rule.endsAt))) return reject('RULE_OUTSIDE_WINDOW');
    if (['first_message', 'chat', 'official_discussion'].includes(data.event) && c.excludedCategoryIds === undefined && (!data.channel || !rule.channels.includes(data.channel))) return reject('CHANNEL_NOT_ELIGIBLE');
    if (c.excludedCategoryIds === undefined && rule.channels.length && data.channel && !rule.channels.includes(data.channel)) return reject('CHANNEL_NOT_ELIGIBLE');
    if ((await tx.query('SELECT id FROM xp_ledger WHERE source_key=$1', [data.source])).length) return reject('DUPLICATE_EVENT');
    if (['first_message', 'boost_first'].includes(data.event) && (await tx.query('SELECT id FROM xp_ledger WHERE user_id=$1 AND event_kind=$2', [data.user, data.event])).length) return reject('ALREADY_REWARDED');
    if (data.hash && (await tx.query("SELECT id FROM xp_ledger WHERE user_id=$1 AND content_hash=$2 AND occurred_at>=$3::timestamptz-interval '24 hours'", [data.user, data.hash, data.occurredAt])).length) return reject('REPEATED_CONTENT');
    if (rule.cooldownSeconds && (await tx.query("SELECT id FROM xp_ledger WHERE user_id=$1 AND event_kind=$2 AND occurred_at>$3::timestamptz-$4*interval '1 second'", [data.user, data.event, data.occurredAt, rule.cooldownSeconds])).length) return reject('COOLDOWN');
    let amount = rule.points;
    if (rule.dailyCap) {
      const [spent] = await tx.query("SELECT COALESCE(SUM(amount),0)::int AS total FROM xp_ledger WHERE user_id=$1 AND event_kind=$2 AND amount>0 AND (occurred_at AT TIME ZONE $3)::date=($4::timestamptz AT TIME ZONE $3)::date", [data.user, data.event, c.timezone, data.occurredAt]);
      amount = Math.min(amount, Math.max(0, rule.dailyCap - Number(spent.total)));
      if (!amount) return reject('DAILY_CAP');
    }
    const [entry] = await tx.query('INSERT INTO xp_ledger(id,user_id,amount,event_kind,source_key,reason,actor_id,rule_version,rule_snapshot,channel_id,content_hash,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [randomUUID(), data.user, amount, data.event, data.source, data.reason, data.actor, revision.version, JSON.stringify(rule), data.channel ?? null, data.hash ?? null, data.occurredAt]);
    await this.audit(tx, data.actor, 'xp.awarded', String(entry.id), { user: data.user, amount, ruleVersion: revision.version });
    return { awarded: true, reason: 'AWARDED', amount, entry };
  }
  async message(input: { user: string; messageId: string; channelId: string; content: string; occurredAt: Date; bot: boolean; categoryId?: string | null; announcement?: boolean }) {
    if (input.bot) return { awarded: false, reason: 'BOT_MESSAGE', amount: 0 };
    userId.parse(input.user); userId.parse(input.messageId); userId.parse(input.channelId);
    if (!(await this.refreshParticipant(input.user)).canEarn) return { awarded: false, reason: 'XP_MEMBER_NOT_ELIGIBLE', amount: 0 };
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_ledger IN EXCLUSIVE MODE');
      const revision = await this.current(tx);
      if (revision.body.excludedCategoryIds !== undefined) {
        if (input.categoryId === undefined || input.announcement === undefined) return { awarded: false, reason: 'CHANNEL_METADATA_UNAVAILABLE', amount: 0 };
        if (input.announcement || (input.categoryId !== null && revision.body.excludedCategoryIds.includes(input.categoryId))) return { awarded: false, reason: 'CHANNEL_NOT_ELIGIBLE', amount: 0 };
      }
      const normalized = input.content.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
      // Ignore emoji/mention/link-only spam, and never persist raw message content.
      const meaningful = normalized.replace(/<[^>]*>|https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
      if (meaningful.length < revision.body.minimumCharacters) return { awarded: false, reason: 'MESSAGE_TOO_SHORT', amount: 0 };
      const eligible = revision.body.rules.filter(r => r.enabled && (revision.body.excludedCategoryIds !== undefined ? r.event !== 'official_discussion' : r.channels.includes(input.channelId)));
      const first = eligible.find(r => r.event === 'first_message');
      const hasFirst = (await tx.query("SELECT id FROM xp_ledger WHERE user_id=$1 AND event_kind='first_message'", [input.user])).length > 0;
      // One message earns one reward: first message, else official discussion, else chat.
      const rule = (!hasFirst && first) || eligible.find(r => r.event === 'official_discussion') || eligible.find(r => r.event === 'chat');
      const event = rule ? rule.event : 'chat';
      return this.award(tx, revision, rule || undefined, { user: input.user, event, source: `message:${input.messageId}`, channel: input.channelId, hash: createHash('sha256').update(normalized).digest('hex'), occurredAt: input.occurredAt, actor: 'gateway', reason: rule ? rule.label : 'Message' });
    });
  }
  async reviewed(actor: Actor, input: unknown) {
    this.requireManager(actor);
    const data = z.object({ userId, event: z.enum(['creation', 'confirmed_issue', 'featured', 'event']), source: sourceId, reason: z.string().trim().min(5).max(500) }).strict().parse(input);
    if (!(await this.refreshParticipant(data.userId)).canEarn) return { awarded: false, reason: 'XP_MEMBER_NOT_ELIGIBLE', amount: 0 };
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_ledger IN EXCLUSIVE MODE');
      const revision = await this.current(tx);
      return this.award(tx, revision, revision.body.rules.find(r => r.event === data.event), { user: data.userId, event: data.event, source: `review:${data.event}:${data.source}${data.event === 'event' ? `:${data.userId}` : ''}`, reason: data.reason, actor: actor.id, occurredAt: new Date() });
    });
  }
  async adjust(actor: Actor, input: unknown) {
    this.requireManager(actor);
    const data = z.object({ userId, amount: z.number().int().min(-10000).max(10000).refine(v => v !== 0), requestKey: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).strict().parse(input);
    if (data.amount > 0 && !(await this.refreshParticipant(data.userId)).canEarn) throw new AppError(409, 'XP_MEMBER_NOT_ELIGIBLE');
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_ledger IN EXCLUSIVE MODE');
      const revision = await this.current(tx);
      if (!revision.body.enabled) throw new AppError(409, 'XP_DISABLED');
      const source = `manual:${data.requestKey}`;
      const [previous] = await tx.query('SELECT * FROM xp_ledger WHERE source_key=$1', [source]);
      if (previous) {
        if (previous.user_id !== data.userId || Number(previous.amount) !== data.amount || previous.reason !== data.reason || previous.actor_id !== actor.id) throw new AppError(409, 'XP_IDEMPOTENCY_CONFLICT');
        return previous;
      }
      const [balance] = await tx.query('SELECT COALESCE(SUM(amount),0)::bigint AS total FROM xp_ledger WHERE user_id=$1', [data.userId]);
      if (Number(balance.total) + data.amount < 0) throw new AppError(409, 'XP_INSUFFICIENT_BALANCE');
      const [entry] = await tx.query("INSERT INTO xp_ledger(id,user_id,amount,event_kind,source_key,reason,actor_id,rule_version,rule_snapshot) VALUES($1,$2,$3,'manual',$4,$5,$6,$7,$8) RETURNING *", [randomUUID(), data.userId, data.amount, source, data.reason, actor.id, revision.version, JSON.stringify({ type: 'manual', amount: data.amount })]);
      await this.audit(tx, actor.id, 'xp.adjusted', String(entry.id), { user: data.userId, amount: data.amount, reason: data.reason });
      return entry;
    });
  }
  async leaderboard(period: XpPeriod = 'weekly', page = 1, now = new Date()) {
    await this.refreshParticipants();
    z.enum(['weekly', 'monthly', 'all_time']).parse(period); z.number().int().min(1).max(100).parse(page);
    const revision = await this.current();
    const start = periodStart(now, period, revision.body.timezone);
    const rows = await this.db.query("WITH totals AS (SELECT user_id,SUM(amount)::bigint AS xp FROM xp_ledger WHERE ($2::date IS NULL OR (occurred_at AT TIME ZONE $1)::date >= $2::date) AND occurred_at<=$3 AND ($5::boolean=false OR EXISTS(SELECT 1 FROM xp_participant p WHERE p.user_id=xp_ledger.user_id AND p.can_rank=true)) GROUP BY user_id HAVING SUM(amount)>0), ranked AS (SELECT user_id,xp,DENSE_RANK() OVER(ORDER BY xp DESC)::int AS rank FROM totals) SELECT * FROM ranked ORDER BY xp DESC,user_id LIMIT 10 OFFSET $4", [revision.body.timezone, start, now, (page - 1) * 10, !!this.participant]);
    return { period, page, enabled: revision.body.enabled, timezone: revision.body.timezone, startsOn: start, entries: rows.map(r => ({ user_id: String(r.user_id), rank: Number(r.rank), xp: Number(r.xp) })) };
  }
  async summary(user: string, now = new Date()) {
    const participation = await this.refreshParticipant(user);
    await this.refreshParticipants();
    const revision = await this.current();
    const [total] = await this.db.query('SELECT COALESCE(SUM(amount),0)::bigint AS xp FROM xp_ledger WHERE user_id=$1 AND occurred_at<=$2', [user, now]);
    const xp = Number(total.xp);
    const level = revision.body.levelThresholds.filter(threshold => xp >= threshold).length;
    const ranks: Record<string, number | null> = {};
    const periodXp: Record<string, number> = {};
    for (const period of ['weekly', 'monthly', 'all_time'] as const) {
      const start = periodStart(now, period, revision.body.timezone);
      const [rank] = await this.db.query("WITH totals AS (SELECT user_id,SUM(amount)::bigint AS xp FROM xp_ledger WHERE ($2::date IS NULL OR (occurred_at AT TIME ZONE $1)::date >= $2::date) AND occurred_at<=$4 GROUP BY user_id), ranked AS (SELECT user_id,DENSE_RANK() OVER(ORDER BY xp DESC)::int AS rank FROM totals WHERE xp>0 AND ($5::boolean=false OR EXISTS(SELECT 1 FROM xp_participant p WHERE p.user_id=totals.user_id AND p.can_rank=true))) SELECT (SELECT rank FROM ranked WHERE user_id=$3) AS rank, COALESCE((SELECT xp FROM totals WHERE user_id=$3),0)::bigint AS xp", [revision.body.timezone, start, user, now, !!this.participant]);
      ranks[period] = rank.rank === null ? null : Number(rank.rank);
      periodXp[period] = Number(rank.xp);
    }
    return { userId: user, lifetimeXp: xp, level, nextLevelXp: revision.body.levelThresholds[level] ?? null, ranks, periodXp, eligible: participation.canEarn, rankEligible: participation.canRank, enabled: revision.body.enabled, timezone: revision.body.timezone };
  }
  async revisions(actor: Actor, input: unknown) {
    this.requireManager(actor);
    const { page, pageSize } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).strict().parse(input);
    const [count] = await this.db.query('SELECT count(*)::int AS total FROM xp_rule_revision');
    const entries = await this.db.query('SELECT * FROM xp_rule_revision ORDER BY version DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize]);
    return { entries, total: Number(count.total), page, pageSize };
  }
  async ledger(actor: Actor, input: unknown) {
    this.requireManager(actor);
    const q = z.object({ memberId: userId.optional(), event: z.enum([...xpEvents, 'manual']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(input);
    if (q.from && q.to && q.from > q.to) throw new AppError(400, 'XP_DATE_RANGE');
    const timezone = (await this.current()).body.timezone;
    const params = [q.memberId ?? null, q.event ?? null, q.from ?? null, q.to ?? null, timezone];
    const where = 'WHERE ($1::text IS NULL OR user_id=$1) AND ($2::text IS NULL OR event_kind=$2) AND ($3::date IS NULL OR occurred_at >= ($3::date::timestamp AT TIME ZONE $5)) AND ($4::date IS NULL OR occurred_at < (($4::date + 1)::timestamp AT TIME ZONE $5))';
    const [count] = await this.db.query(`SELECT count(*)::int AS total FROM xp_ledger ${where}`, params);
    const entries = await this.db.query(`SELECT * FROM xp_ledger ${where} ORDER BY occurred_at DESC,id DESC LIMIT $6 OFFSET $7`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
    return { entries, total: Number(count.total), page: q.page, pageSize: q.pageSize, timezone };
  }
  async member(actor: Actor, user: string, input: unknown) {
    this.requireManager(actor); userId.parse(user);
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(input);
    return { userId: user, summary: await this.summary(user), ledger: await this.ledger(actor, { memberId: user, page }) };
  }
  async history(user: string, page = 1) {
    z.number().int().min(1).max(100).parse(page);
    return this.db.query('SELECT id,amount,event_kind,reason,rule_version,occurred_at FROM xp_ledger WHERE user_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 10 OFFSET $2', [user, (page - 1) * 10]);
  }
  async observeBoost(user: string, since: Date | null, firstEligible: boolean, verify = false) {
    userId.parse(user);
    await this.db.transaction(async tx => {
      await tx.query('LOCK TABLE xp_boost_state IN EXCLUSIVE MODE');
      if (!since) { await tx.query('UPDATE xp_boost_state SET active=false,verified_at=now(),last_error_code=NULL,next_check_at=now()+interval \'6 hours\' WHERE user_id=$1', [user]); return; }
      const [old] = await tx.query('SELECT * FROM xp_boost_state WHERE user_id=$1', [user]);
      const same = !!old && old.active === true && new Date(old.started_at as string).getTime() === since.getTime();
      if (!same) {
        await tx.query('INSERT INTO xp_boost_state(user_id,started_at,active,verified_at,next_check_at,next_cycle_at,first_eligible) VALUES($1,$2,true,now(),now(),$3,$4) ON CONFLICT(user_id) DO UPDATE SET started_at=EXCLUDED.started_at,active=true,verified_at=now(),last_error_code=NULL,next_check_at=now(),next_cycle_at=EXCLUDED.next_cycle_at,first_eligible=EXCLUDED.first_eligible', [user, since, new Date(Math.max(since.getTime() + thirtyDays, Date.now())), firstEligible]);
      } else if (verify) await tx.query("UPDATE xp_boost_state SET verified_at=now(),last_error_code=NULL,next_check_at=now()+interval '6 hours' WHERE user_id=$1", [user]);
    });
  }
  // Verification is read-only Discord REST. A failure never implies cancellation or an award.
  async checkBoosts(fetchSince: (user: string) => Promise<Date | null>) {
    const config = (await this.current()).body;
    if (!config.enabled || !config.rules.some(rule => rule.enabled && ['boost_first', 'boost_30d'].includes(rule.event))) return;
    const due = await this.db.query('SELECT user_id FROM xp_boost_state WHERE active=true AND next_check_at<=now() ORDER BY next_check_at LIMIT 20');
    for (const row of due) {
      const user = String(row.user_id);
      let since: Date | null;
      try {
        if (!(await this.refreshParticipant(user)).canEarn) {
          await this.db.query("UPDATE xp_boost_state SET last_error_code='XP_MEMBER_NOT_ELIGIBLE',next_check_at=now()+interval '5 minutes' WHERE user_id=$1", [user]);
          continue;
        }
        since = await fetchSince(user);
      }
      catch {
        await this.db.query("UPDATE xp_boost_state SET last_error_code='BOOST_LOOKUP_FAILED',next_check_at=now()+interval '5 minutes' WHERE user_id=$1", [user]);
        continue;
      }
      await this.observeBoost(user, since, false, true);
      if (!since) continue;
      await this.db.transaction(async tx => {
        await tx.query('LOCK TABLE xp_ledger IN EXCLUSIVE MODE');
        await tx.query('LOCK TABLE xp_boost_state IN EXCLUSIVE MODE');
        const [state] = await tx.query('SELECT * FROM xp_boost_state WHERE user_id=$1 AND active=true', [user]);
        if (!state || new Date(state.started_at as string).getTime() !== since.getTime()) return;
        const revision = await this.current(tx);
        if (!revision.body.enabled) return;
        if (state.first_eligible) {
          await this.award(tx, revision, revision.body.rules.find(r => r.event === 'boost_first'), { user, event: 'boost_first', source: `boost:first:${user}`, actor: 'boost-verifier', occurredAt: since, reason: 'Verified first qualifying Boost' });
        }
        const cycles = Math.floor((Date.now() - since.getTime()) / thirtyDays);
        const cycleAt = new Date(since.getTime() + cycles * thirtyDays);
        if (cycles >= 1 && cycleAt >= new Date(state.next_cycle_at as string)) {
          const result = await this.award(tx, revision, revision.body.rules.find(r => r.event === 'boost_30d'), { user, event: 'boost_30d', source: `boost:${user}:${since.toISOString()}:${cycles}`, actor: 'boost-verifier', occurredAt: cycleAt, reason: 'Verified 30 continuous days of Boost' });
          if (result.awarded || result.reason === 'DUPLICATE_EVENT' || result.reason === 'EVENT_OUTSIDE_RULE_VERSION') await tx.query('UPDATE xp_boost_state SET next_cycle_at=$2 WHERE user_id=$1', [user, new Date(since.getTime() + (cycles + 1) * thirtyDays)]);
        }
      });
    }
  }
}

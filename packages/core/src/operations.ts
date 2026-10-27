import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type Actor } from './config.js';
import type { Database } from '../../db/src.js';
import type { Transport } from './transport.js';
const snowflake = z.string().regex(/^\d{17,20}$/);
export const monitoringSchema = z.object({ enabled: z.boolean(), channelIds: z.array(snowflake).max(30), excludedCategoryIds: z.array(snowflake).max(30), keywords: z.array(z.string().trim().min(2).max(60)).max(50) }).strict();
const emptySettings = { enabled: false, channelIds: [], excludedCategoryIds: [], keywords: [] };
export class Operations {
  constructor(readonly db: Database, readonly transport: Transport, readonly mock: boolean) {}
  async initialize() { await this.db.query('INSERT INTO operations_settings(id,body) VALUES(1,$1) ON CONFLICT(id) DO NOTHING', [JSON.stringify(emptySettings)]); }
  require(actor: Actor, root = false) { if (root ? actor.role !== 'SUPER_ADMIN' : actor.role === 'SUPPORT') throw new AppError(403, 'FORBIDDEN'); }
  async observeProfile(user: string, name: string, username = '') {
    if (!name.trim()) return;
    await this.db.query('INSERT INTO member_profile(user_id,display_name,username) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET display_name=$2,username=$3,updated_at=now()', [user, name.slice(0, 128), username.slice(0, 128)]);
  }
  async profile(user: string) {
    const [cached] = await this.db.query('SELECT * FROM member_profile WHERE user_id=$1', [user]);
    if (cached && Date.now() - new Date(String(cached.updated_at)).getTime() < 300000) return cached;
    if (/^\d{17,20}$/.test(user) && this.transport.memberProfile) {
      try { const member = await this.transport.memberProfile(user); await this.observeProfile(user, member.displayName, member.username); return { user_id: user, display_name: member.displayName, username: member.username }; }
      catch { /* Retain last observed name without inventing a replacement. */ }
    }
    return cached ?? { user_id: user, display_name: null, username: null };
  }
  async settings(actor: Actor) { this.require(actor); return (await this.db.query('SELECT * FROM operations_settings WHERE id=1'))[0]; }
  async saveSettings(actor: Actor, input: unknown) {
    this.require(actor, true);
    const data = z.object({ body: monitoringSchema, expectedVersion: z.number().int().positive() }).strict().parse(input);
    if (data.body.enabled && (!data.body.channelIds.length || !data.body.keywords.length)) throw new AppError(400, 'RISK_SCOPE_REQUIRED');
    const rows = await this.db.query('UPDATE operations_settings SET body=$1,revision=revision+1,updated_by=$2,updated_at=now() WHERE id=1 AND revision=$3 RETURNING *', [JSON.stringify(data.body), actor.id, data.expectedVersion]);
    if (!rows.length) throw new AppError(409, 'CONFIG_CHANGED_RELOAD');
    await this.audit(actor, 'risk.settings_updated', 'monitoring'); return rows[0];
  }
  async staff(actor: Actor) { this.require(actor, true); return this.db.query('SELECT * FROM staff_access ORDER BY updated_at DESC LIMIT 100'); }
  async authorize(actor: Actor, user: string, input: unknown, protectedUsers: string[]) {
    this.require(actor, true); snowflake.parse(user);
    const data = z.object({ role: z.enum(['COMMUNITY_MANAGER', 'MODERATOR', 'SUPPORT']), revoked: z.boolean(), expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(500) }).strict().parse(input);
    if (user === actor.id || protectedUsers.includes(user)) throw new AppError(403, 'ROOT_ACCESS_PROTECTED');
    if (!data.revoked && this.transport.memberProfile && (await this.transport.memberProfile(user)).bot) throw new AppError(400, 'STAFF_HUMAN_REQUIRED');
    return this.db.transaction(async tx => {
      await tx.query('LOCK TABLE staff_access IN EXCLUSIVE MODE');
      const [old] = await tx.query('SELECT revision FROM staff_access WHERE user_id=$1', [user]);
      if (Number(old?.revision ?? 0) !== data.expectedVersion) throw new AppError(409, 'CONFIG_CHANGED_RELOAD');
      const [row] = await tx.query('INSERT INTO staff_access(user_id,role,revoked,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET role=$2,revoked=$3,revision=staff_access.revision+1,updated_by=$4,updated_at=now() RETURNING *', [user, data.role, data.revoked, actor.id]);
      await tx.query('DELETE FROM admin_session WHERE user_id=$1', [user]);
      await tx.query("UPDATE ticket_reply SET status='CANCELLED',error_code='TICKET_REPLY_NO_LONGER_AUTHORIZED',updated_at=now() WHERE authored_by=$1 AND authored_role<>'SYSTEM' AND status IN ('PENDING','RETRY')", [user]);
      await tx.query("UPDATE ticket SET sync_status='PENDING',sync_at=now(),sync_attempts=0,revision=revision+1 WHERE private_channel_id IS NOT NULL AND status IN ('OPEN','INVESTIGATING','WAITING_USER','RESOLVED','CLOSED')");
      await tx.query('INSERT INTO audit_log(id,actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor.id, 'staff.access_updated', user, JSON.stringify({ ...data, expectedVersion: undefined })]);
      return row;
    });
  }
  async heartbeat(members: boolean, messages: boolean, content: boolean) {
    await this.db.query('INSERT INTO gateway_observation(id,members_enabled,messages_enabled,content_enabled) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET last_seen_at=now(),members_enabled=$1,messages_enabled=$2,content_enabled=$3', [members, messages, content]);
  }
  async membership(kind: 'JOIN' | 'LEAVE', user: string, key: string, at = new Date()) {
    await this.db.transaction(async tx => {
      await tx.query('INSERT INTO member_presence(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user]);
      const [presence] = await tx.query('SELECT * FROM member_presence WHERE user_id=$1 FOR UPDATE', [user]);
      if (kind === 'LEAVE' && presence.state === 'ABSENT') return;
      if (kind === 'JOIN' && (await tx.query('SELECT event_key FROM community_event WHERE event_key=$1', [key])).length) return;
      const eventKey = kind === 'LEAVE' && presence.last_join_key ? `leave:${user}:${presence.last_join_key}` : key;
      await tx.query("UPDATE member_presence SET state=$2,last_join_key=CASE WHEN $2='PRESENT' THEN $3 ELSE last_join_key END WHERE user_id=$1", [user, kind === 'JOIN' ? 'PRESENT' : 'ABSENT', key]);
      await tx.query('INSERT INTO community_event(event_key,kind,user_id,occurred_at) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING', [eventKey, kind, user, at]);
    });
  }
  async message(input: { id: string; user: string; channel: string; category: string | null; parent: string | null; at: Date; content?: string }) {
    const [ticket] = await this.db.query('SELECT id FROM ticket WHERE private_channel_id=$1 OR private_channel_id=$2 LIMIT 1', [input.channel, input.parent]);
    if (ticket) return;
    await this.db.query("INSERT INTO community_event(event_key,kind,user_id,channel_id,occurred_at) VALUES($1,'MESSAGE',$2,$3,$4) ON CONFLICT(event_key) DO NOTHING", [input.id, input.user, input.channel, input.at]);
    const [settings] = await this.db.query('SELECT body FROM operations_settings WHERE id=1');
    const config = monitoringSchema.parse(settings.body);
    if (!config.enabled || !config.channelIds.includes(input.channel) && !(input.parent && config.channelIds.includes(input.parent)) || input.category && config.excludedCategoryIds.includes(input.category) || !input.content) return;
    const matches = config.keywords.filter(word => input.content!.normalize('NFKC').toLocaleLowerCase().includes(word.normalize('NFKC').toLocaleLowerCase()));
    if (matches.length) await this.db.query('INSERT INTO risk_signal(message_id,user_id,channel_id,matches,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING', [input.id, input.user, input.channel, JSON.stringify(matches), input.at]);
  }
  async overview(actor: Actor, days: number, timezone: string) {
    this.require(actor); z.number().int().min(1).max(30).parse(days);
    const [coverage] = await this.db.query('SELECT * FROM gateway_observation WHERE id=1');
    const params = [timezone, days];
    const where = "occurred_at >= (date_trunc('day',now() AT TIME ZONE $1)-($2-1)*interval '1 day') AT TIME ZONE $1 AND occurred_at<=now()";
    const [totals] = await this.db.query(`SELECT count(*) FILTER(WHERE kind='JOIN')::int AS joins,count(*) FILTER(WHERE kind='LEAVE')::int AS leaves,count(*) FILTER(WHERE kind='MESSAGE')::int AS messages,count(DISTINCT user_id) FILTER(WHERE kind='MESSAGE')::int AS speakers FROM community_event WHERE ${where}`, params);
    const daily = await this.db.query(`SELECT (occurred_at AT TIME ZONE $1)::date::text AS day,count(*) FILTER(WHERE kind='JOIN')::int AS joins,count(*) FILTER(WHERE kind='LEAVE')::int AS leaves,count(*) FILTER(WHERE kind='MESSAGE')::int AS messages,count(DISTINCT user_id) FILTER(WHERE kind='MESSAGE')::int AS speakers FROM community_event WHERE ${where} GROUP BY 1 ORDER BY 1`, params);
    const [risk] = await this.db.query("SELECT count(*)::int AS open FROM risk_signal WHERE status='OPEN'");
    return { totals, daily, coverage: coverage ?? null, days, timezone, riskOpen: Number(risk.open), generatedAt: new Date().toISOString() };
  }
  async risks(actor: Actor, page = 1) { this.require(actor); z.number().int().min(1).max(100000).parse(page); const [count] = await this.db.query('SELECT count(*)::int AS total FROM risk_signal'); return { entries: await this.db.query('SELECT * FROM risk_signal ORDER BY created_at DESC,message_id DESC LIMIT 20 OFFSET $1', [(page - 1) * 20]), page, pageSize: 20, total: Number(count.total) }; }
  async review(actor: Actor, message: string, input: unknown) {
    this.require(actor); const data = z.object({ status: z.enum(['CONFIRMED','DISMISSED']), note: z.string().trim().min(5).max(500) }).strict().parse(input);
    const rows = await this.db.query("UPDATE risk_signal SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE message_id=$1 AND status='OPEN' RETURNING *", [message, data.status, data.note, actor.id]);
    if (!rows.length) throw new AppError(409, 'RISK_ALREADY_REVIEWED'); await this.audit(actor, 'risk.reviewed', message); return rows[0];
  }
  async cleanup() { await this.db.query("DELETE FROM community_event WHERE occurred_at<now()-interval '90 days'"); }
  private async audit(actor: Actor, action: string, entity: string) { await this.db.query('INSERT INTO audit_log(id,actor_id,action,entity_id) VALUES($1,$2,$3,$4)', [randomUUID(), actor.id, action, entity]); }
}

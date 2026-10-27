import { randomUUID, randomInt } from 'node:crypto';
import type { Database, Queryable } from '../../db/src.js';
import { AppError, can, configSchema, defaults, type Actor, type Config } from './config.js';
import { DeliveryError, type Transport } from './transport.js';
import { exampleSeeds } from './seeds.js';
import { z } from 'zod';
import { TemplatePromptProvider, type PromptProvider } from '../../ai-adapter/src.js';
import type { WelcomeAppearance } from './welcome-card.js';
import { ticketCategories, ticketPriorities, ticketStatuses } from './ticket-config.js';
import { XpService } from './xp.js';
import { Operations } from './operations.js';

export type Row = Record<string, unknown>;
type Revision = Row & { id: string; version: number; body: Config; status: string };
export type Ticket = Row & { id: string; seq: number; creator_id: string; assigned_to: string | null; private_channel_id: string | null; status: string; closed_at: Date | null; category: string; summary: string; description: string; environment: string; priority: string; revision: number; card_message_id: string | null; sync_status: string; sync_attempts: number };
const ticketInput = z.object({ category: z.enum(ticketCategories), summary: z.string().trim().min(5).max(120), description: z.string().trim().min(10).max(3000), environment: z.string().trim().max(500).default('') }).strict();

export class CommunityService {
  readonly xp: XpService;
  readonly operations: Operations;
  constructor(readonly db: Database, readonly transport: Transport, readonly mock = true, readonly prompts: PromptProvider = new TemplatePromptProvider()) { this.xp = new XpService(db, transport.xpParticipant?.bind(transport)); this.operations = new Operations(db, transport, mock); }
  async audit(tx: Queryable, actor: string, action: string, entity: string | null = null, detail: Row = {}) {
    await tx.query('INSERT INTO audit_log(id,actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor, action, entity, JSON.stringify(detail)]);
  }
  async event(tx: Queryable, type: string, key: string, payload: Row) {
    await tx.query('INSERT INTO event_outbox(event_id,event_type,source_key,payload_json) VALUES($1,$2,$3,$4) ON CONFLICT(source_key) DO NOTHING', [randomUUID(), type, key, JSON.stringify(payload)]);
  }
  async initialize() {
    await this.db.transaction(async tx => {
      await tx.query('LOCK TABLE config_revision IN EXCLUSIVE MODE');
      const rows = await tx.query('SELECT id FROM config_revision LIMIT 1');
      if (!rows.length) await tx.query("INSERT INTO config_revision(id,status,body,authored_by,published_by,published_at) VALUES($1,'PUBLISHED',$2,'system','system',now())", [randomUUID(), JSON.stringify(defaults)]);
      if (!(await tx.query('SELECT id FROM idea_seed LIMIT 1')).length) {
        for (const [title, text, category] of exampleSeeds) await tx.query('INSERT INTO idea_seed(id,title,seed_text,category,active,moderation_status) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), title, text, category, this.mock, this.mock ? 'MOCK_ONLY' : 'PENDING_APPROVAL']);
      }
    });
    await this.xp.initialize();
    await this.operations.initialize();
    await this.db.query("UPDATE ticket SET status='UNKNOWN',error_code='TICKET_PROVISION_INTERRUPTED' WHERE status='PROVISIONING' AND created_at<now()-interval '2 minutes'");
    // An external send may have succeeded before a process died. Never blindly replay it.
    // Stale SENDING deliveries are surfaced as UNKNOWN by the worker after its lease interval.
  }
  async current(tx: Queryable = this.db, lock = false): Promise<Revision> {
    if (lock) await tx.query('LOCK TABLE config_revision IN EXCLUSIVE MODE');
    const [revision] = await tx.query<Revision>("SELECT * FROM config_revision WHERE status='PUBLISHED'");
    if (!revision) throw new AppError(503, 'CONFIG_NOT_INITIALIZED');
    return revision;
  }
  require(actor: Actor, action: Parameters<typeof can>[1]) { if (!can(actor, action)) throw new AppError(403, 'FORBIDDEN'); }
  async createDraft(actor: Actor, input: unknown) {
    this.require(actor, 'config');
    const body = configSchema.parse(input);
    return this.db.transaction(async tx => {
      const [draft] = await tx.query<Revision>("INSERT INTO config_revision(id,status,body,authored_by) VALUES($1,'DRAFT',$2,$3) RETURNING *", [randomUUID(), JSON.stringify(body), actor.id]);
      await this.audit(tx, actor.id, 'config.drafted', draft.id, { version: draft.version });
      return draft;
    });
  }
  async publish(actor: Actor, id: string, expectedVersion: number) {
    this.require(actor, 'publish');
    return this.db.transaction(async tx => {
      const current = await this.current(tx, true);
      if (current.version !== expectedVersion) throw new AppError(409, 'CONFIG_CHANGED_RELOAD');
      const [draft] = await tx.query<Revision>("SELECT * FROM config_revision WHERE id=$1 AND status='DRAFT' FOR UPDATE", [id]);
      if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND');
      configSchema.parse(draft.body);
      await tx.query("UPDATE config_revision SET status='SUPERSEDED' WHERE status='PUBLISHED'");
      const [published] = await tx.query<Revision>("UPDATE config_revision SET status='PUBLISHED',published_by=$2,published_at=now() WHERE id=$1 RETURNING *", [id, actor.id]);
      await this.audit(tx, actor.id, 'config.published', id, { from: current.version, to: published.version });
      await this.event(tx, 'lifecycle.published', `config:${id}`, { version: published.version, phase: published.body.phase });
      return published;
    });
  }
  async rollback(actor: Actor, id: string) {
    this.require(actor, 'config');
    const [old] = await this.db.query<Revision>('SELECT * FROM config_revision WHERE id=$1', [id]);
    if (!old) throw new AppError(404, 'REVISION_NOT_FOUND');
    return this.createDraft(actor, old.body); // Always preview and explicitly publish the new revision.
  }
  async seeds() { return this.db.query('SELECT * FROM idea_seed ORDER BY title'); }
  async addSeed(actor: Actor, input: unknown) {
    this.require(actor, 'config');
    const seed = z.object({ title: z.string().trim().min(3).max(100), seed_text: z.string().trim().min(10).max(500), category: z.string().trim().min(2).max(50), approved: z.boolean() }).strict().parse(input);
    return this.db.transaction(async tx => {
      const [row] = await tx.query('INSERT INTO idea_seed(id,title,seed_text,category,active,moderation_status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), seed.title, seed.seed_text, seed.category, seed.approved, seed.approved ? 'APPROVED' : 'PENDING_APPROVAL']);
      await this.audit(tx, actor.id, 'seed.created', String(row.id), { approved: seed.approved });
      return row;
    });
  }
  async idea(user: string) {
    return this.db.transaction(async tx => {
      await this.current(tx, true);
      const seeds = await tx.query('SELECT * FROM idea_seed WHERE active=true');
      if (!seeds.length) throw new AppError(409, 'NO_APPROVED_SEEDS');
      const [drawCount] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM idea_draw WHERE user_id=$1 AND created_at>now()-interval '1 hour'", [user]);
      if (Number(drawCount.count) >= 60) throw new AppError(429, 'IDEA_HOURLY_LIMIT');
      const recent = await tx.query('SELECT seed_id FROM idea_draw WHERE user_id=$1 ORDER BY created_at DESC LIMIT 3', [user]);
      const eligible = seeds.filter(s => !recent.some(r => r.seed_id === s.id));
      const choices = eligible.length ? eligible : seeds;
      const seed = choices[randomInt(choices.length)];
      await tx.query('INSERT INTO idea_draw(id,user_id,seed_id) VALUES($1,$2,$3)', [randomUUID(), user, seed.id]);
      return seed;
    });
  }
  async prompt(user: string, seedId: string) {
    return this.db.transaction(async tx => {
      const { body: c } = await this.current(tx, true);
      const [count] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM prompt_generation WHERE user_id=$1 AND created_at >= date_trunc('day',now())", [user]);
      if (Number(count.count) >= c.promptDailyLimit) throw new AppError(429, 'PROMPT_DAILY_LIMIT');
      const [seed] = await tx.query('SELECT * FROM idea_seed WHERE id=$1 AND active=true', [seedId]);
      if (!seed) throw new AppError(404, 'SEED_NOT_AVAILABLE');
      let prompt: string;
      try { prompt = await this.prompts.generate({ template: c.persona.promptTemplate, title: String(seed.title), seedText: String(seed.seed_text), category: String(seed.category) }); }
      catch { prompt = await new TemplatePromptProvider().generate({ template: c.persona.promptTemplate, title: String(seed.title), seedText: String(seed.seed_text), category: String(seed.category) }); }
      const [generation] = await tx.query('INSERT INTO prompt_generation(id,user_id,seed_id,generated_prompt) VALUES($1,$2,$3,$4) RETURNING *', [randomUUID(), user, seedId, prompt]);
      await this.event(tx, 'idea.prompt_generated', `prompt:${generation.id}`, { user_id: user, seed_id: seedId, provider: 'TEMPLATE_FALLBACK' });
      return generation;
    });
  }
  ticketVisible(actor: Actor, ticket: Ticket) { return actor.id === ticket.creator_id || actor.role !== 'SUPPORT' || ticket.assigned_to === actor.id; }
  async tickets(actor: Actor) {
    return actor.role === 'SUPPORT'
      ? this.db.query<Ticket>('SELECT * FROM ticket WHERE creator_id=$1 OR assigned_to=$1 ORDER BY created_at DESC', [actor.id])
      : this.db.query<Ticket>('SELECT * FROM ticket ORDER BY created_at DESC LIMIT 200');
  }
  async ticket(actor: Actor, id: string, page = 1) {
    z.number().int().min(1).max(100000).parse(page);
    const [ticket] = await this.db.query<Ticket>('SELECT * FROM ticket WHERE id=$1', [id]);
    if (!ticket || !this.ticketVisible(actor, ticket)) throw new AppError(404, 'TICKET_NOT_FOUND');
    const [count] = await this.db.query('SELECT count(*)::int AS count FROM ticket_event WHERE ticket_id=$1', [id]);
    const [award] = await this.db.query('SELECT amount,occurred_at FROM xp_ledger WHERE source_key=$1', [`review:confirmed_issue:ticket:${id}`]);
    return { ...ticket, events: await this.db.query('SELECT * FROM ticket_event WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2', [id, (page - 1) * 20]), eventCount: Number(count.count), eventPage: page, eventPageSize: 20, issue_award: award ?? null, replies: await this.db.query('SELECT id,authored_by,body,status,error_code,created_at FROM ticket_reply WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 10', [id]) };
  }
  async createTicket(user: string, requestKey: string, input: unknown) {
    const data = ticketInput.parse(input);
    const ticket = await this.db.transaction(async tx => {
      const { body: c } = await this.current(tx, true);
      const [existing] = await tx.query<Ticket>('SELECT * FROM ticket WHERE request_key=$1 AND creator_id=$2', [requestKey, user]);
      if (existing) return existing;
      if (!this.mock && (!c.enabled.tickets || !c.channels.ticketCategory)) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
      const [hourly] = await tx.query("SELECT count(*)::int AS count FROM ticket WHERE creator_id=$1 AND created_at>now()-interval '1 hour'", [user]);
      if (Number(hourly.count) >= (c.ticketHourlyLimit ?? 5)) throw new AppError(429, 'TICKET_HOURLY_LIMIT');
      const [count] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM ticket WHERE creator_id=$1 AND status NOT IN ('CLOSED','FAILED')", [user]);
      if (Number(count.count) >= c.ticketLimit) throw new AppError(429, 'ACTIVE_TICKET_LIMIT');
      const [created] = await tx.query<Ticket>("INSERT INTO ticket(id,request_key,creator_id,category,summary,description,phase,status,environment) VALUES($1,$2,$3,$4,$5,$6,$7,'CREATING',$8) RETURNING *", [randomUUID(), requestKey, user, data.category, data.summary, data.description, c.phase, data.environment]);
      return created;
    });
    // Only the original creator path may perform the external effect. Claim once atomically.
    const claimed = await this.db.query<Ticket>("UPDATE ticket SET status='PROVISIONING' WHERE id=$1 AND status='CREATING' RETURNING *", [ticket.id]);
    if (!claimed.length) return ticket;
    let channel: string | undefined;
    try {
      const c = (await this.current()).body;
      if (!this.mock && (!c.enabled.tickets || !c.channels.ticketCategory)) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
      channel = await this.transport.createTicket(user, c.channels.ticketCategory, ticket.seq);
      await this.db.query("UPDATE ticket SET private_channel_id=$2 WHERE id=$1 AND status='PROVISIONING'", [ticket.id, channel]);
      const cardId = await this.transport.send(channel, `Ticket #${ticket.seq}\n${ticket.summary}\n${String(ticket.description).slice(0, 1500)}\nPlease attach screenshots here if needed. Our support team will review your request.`, ticket.id, { ticketCard: { ...ticket, status: 'OPEN' } });
      return await this.db.transaction(async tx => {
        const [opened] = await tx.query<Ticket>("UPDATE ticket SET status='OPEN',private_channel_id=$2,card_message_id=$3,sync_status='SYNCED',updated_at=now() WHERE id=$1 RETURNING *", [ticket.id, channel, cardId]);
        await this.audit(tx, user, 'ticket.created', ticket.id);
        await this.event(tx, 'ticket.created', `ticket:${ticket.id}`, { ticket_id: ticket.id });
        return opened;
      });
    } catch (e) {
      let errorCode = e instanceof AppError ? e.code : !channel && e instanceof DeliveryError && e.kind === 'ambiguous' ? 'TICKET_PROVISION_UNKNOWN' : 'PRIVATE_CHANNEL_PROVISION_FAILED';
      if (channel) {
        try { await this.transport.deleteTicket(channel); }
        catch { errorCode = 'PRIVATE_CHANNEL_CLEANUP_REQUIRED'; }
      }
      await this.db.query("UPDATE ticket SET status=$4,error_code=$2,private_channel_id=$3,sync_status='FAILED' WHERE id=$1", [ticket.id, errorCode, channel ?? null, ['TICKET_PROVISION_UNKNOWN','PRIVATE_CHANNEL_CLEANUP_REQUIRED'].includes(errorCode) ? 'UNKNOWN' : 'FAILED']);
      await this.audit(this.db, user, 'ticket.provision_failed', ticket.id, { error_code: errorCode });
      throw new AppError(502, errorCode);
    }
  }
  async ticketSearch(actor: Actor, input: unknown) {
    const q = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), status: z.enum([...ticketStatuses, 'FAILED', 'UNKNOWN', 'CREATING', 'PROVISIONING']).optional(), priority: z.enum(ticketPriorities).optional(), category: z.enum(ticketCategories).optional(), member: z.string().trim().min(1).max(30).optional(), assigned: z.string().trim().min(1).max(30).optional(), search: z.string().trim().min(1).max(100).optional() }).strict().parse(input);
    const params = [actor.role === 'SUPPORT' ? actor.id : null, q.status ?? null, q.priority ?? null, q.category ?? null, q.member ?? null, q.assigned ?? null, q.search ? `%${q.search.replace(/[\\%_]/g, '\\$&')}%` : null];
    const where = 'WHERE ($1::text IS NULL OR creator_id=$1 OR assigned_to=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR priority=$3) AND ($4::text IS NULL OR category=$4) AND ($5::text IS NULL OR creator_id=$5) AND ($6::text IS NULL OR assigned_to=$6) AND ($7::text IS NULL OR summary ILIKE $7 OR seq::text ILIKE $7)';
    const [count] = await this.db.query(`SELECT count(*)::int AS total FROM ticket ${where}`, params);
    const entries = await this.db.query(`SELECT * FROM ticket ${where} ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET $8`, [...params, (q.page - 1) * 20]);
    return { entries, page: q.page, pageSize: 20, total: Number(count.total) };
  }
  async updateTicket(actor: Actor, id: string, input: unknown) {
    const data = z.object({ status: z.enum(ticketStatuses).optional(), note: z.string().trim().min(3).max(1000), assignedTo: z.string().trim().max(30).nullable().optional(), priority: z.enum(ticketPriorities).optional(), expectedVersion: z.number().int().positive().optional() }).strict().parse(input);
    if (!this.mock && data.assignedTo && this.transport.ticketStaff) await this.transport.ticketStaff(z.string().regex(/^\d{17,20}$/).parse(data.assignedTo));
    return this.db.transaction(async tx => {
      const { body: c } = await this.current(tx, true);
      const [ticket] = await tx.query<Ticket>('SELECT * FROM ticket WHERE id=$1 FOR UPDATE', [id]);
      if (!ticket || !this.ticketVisible(actor, ticket)) throw new AppError(404, 'TICKET_NOT_FOUND');
      if (!ticketStatuses.some(status => status === ticket.status)) throw new AppError(409, 'TICKET_NOT_ACTIVE');
      if (data.expectedVersion !== undefined && Number(ticket.revision) !== data.expectedVersion) throw new AppError(409, 'TICKET_CHANGED');
      if (actor.role === 'SUPPORT' && data.assignedTo !== undefined && data.assignedTo !== ticket.assigned_to) throw new AppError(403, 'CANNOT_REASSIGN');
      const status = data.status ?? ticket.status;
      if (ticket.status === 'CLOSED' && status !== 'CLOSED') {
        if (!ticket.private_channel_id) throw new AppError(409, 'TICKET_CHANNEL_MISSING');
        if (status !== 'OPEN' || !ticket.closed_at || Date.now() - new Date(ticket.closed_at).getTime() > c.reopenDays * 86400000) throw new AppError(409, 'REOPEN_WINDOW_EXPIRED');
        const [count] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM ticket WHERE creator_id=$1 AND status NOT IN ('CLOSED','FAILED')", [ticket.creator_id]);
        if (Number(count.count) >= c.ticketLimit) throw new AppError(409, 'ACTIVE_TICKET_LIMIT');
      }
      const assigned = data.assignedTo === undefined ? ticket.assigned_to : data.assignedTo || null;
      const [updated] = await tx.query<Ticket>("UPDATE ticket SET status=$2,assigned_to=$3,priority=$4,closed_at=CASE WHEN $2='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END,revision=revision+1,updated_at=now(),sync_status='PENDING',sync_attempts=0,sync_at=now(),sync_error=NULL WHERE id=$1 RETURNING *", [id, status, assigned, data.priority ?? ticket.priority]);
      await tx.query('INSERT INTO ticket_event(id,ticket_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, actor.id, status === ticket.status ? 'NOTE' : status, JSON.stringify({ note: data.note, from: ticket.status, to: status, assignedFrom: ticket.assigned_to, assignedTo: assigned, priority: updated.priority })]);
      if (status !== ticket.status) {
        const notices: Record<string, string> = {
          OPEN: `Ticket #${ticket.seq} has been reopened. You can continue the conversation here.`,
          INVESTIGATING: `Our support team is reviewing ticket #${ticket.seq}. We’ll follow up here.`,
          WAITING_USER: `Ticket #${ticket.seq} is waiting for your reply. Please check the support team’s questions above and add any missing details.`,
          RESOLVED: `Ticket #${ticket.seq} has been marked resolved. If you still need help, let us know here before it is closed.`,
          CLOSED: `Ticket #${ticket.seq} is closed. This conversation is read-only after synchronization. You can use Reopen ticket within ${c.reopenDays} days if you need more help.`,
        };
        await tx.query('INSERT INTO ticket_reply(id,ticket_id,authored_by,authored_role,body,expected_status) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), id, actor.id, 'SYSTEM', notices[status], status]);
      }
      await this.audit(tx, actor.id, 'ticket.updated', id, { status, revision: updated.revision });
      return updated;
    });
  }
  async memberTicketAction(user: string, id: string, status: 'CLOSED' | 'OPEN', note: string) {
    const [ticket] = await this.db.query<Ticket>('SELECT * FROM ticket WHERE id=$1 AND creator_id=$2', [id, user]);
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND');
    if (status === 'CLOSED' && ticket.status === 'CLOSED') return ticket;
    const [recent] = await this.db.query("SELECT count(*)::int AS count FROM ticket_event WHERE ticket_id=$1 AND actor_id=$2 AND created_at>now()-interval '1 minute'", [id, user]);
    if (Number(recent.count) >= 6) throw new AppError(429, 'TICKET_ACTION_LIMIT');
    if (status === 'OPEN' && ticket.status !== 'CLOSED') throw new AppError(409, 'TICKET_NOT_CLOSED');
    return this.updateTicket({ id: user, role: 'SUPPORT' }, id, { status, note, expectedVersion: Number(ticket.revision) });
  }
  async reviewUncertainTicket(actor: Actor, id: string, input: unknown) {
    this.require(actor, 'config');
    const data = z.object({ confirm: z.literal(true), note: z.string().trim().min(10).max(1000), expectedVersion: z.number().int().positive() }).strict().parse(input);
    return this.db.transaction(async tx => {
      const [ticket] = await tx.query<Ticket>('SELECT * FROM ticket WHERE id=$1 FOR UPDATE', [id]);
      if (!ticket || !['UNKNOWN','FAILED'].includes(ticket.status)) throw new AppError(409, 'TICKET_NOT_UNCERTAIN');
      if (ticket.revision !== data.expectedVersion) throw new AppError(409, 'TICKET_CHANGED');
      await tx.query("UPDATE ticket SET status='CLOSED',closed_at=now(),revision=revision+1,updated_at=now(),sync_status=CASE WHEN private_channel_id IS NULL THEN 'SYNCED' ELSE 'PENDING' END,sync_attempts=0,sync_at=now() WHERE id=$1", [id]);
      await tx.query('INSERT INTO ticket_event(id,ticket_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, actor.id, 'PROVISION_REVIEWED', JSON.stringify({ note: data.note })]);
      await this.audit(tx, actor.id, 'ticket.provision_reviewed', id);
      return { ok: true };
    });
  }
  async retryTicketSync(actor: Actor, id: string) {
    const ticket = await this.ticket(actor, id);
    if (!ticketStatuses.some(status => status === ticket.status)) throw new AppError(409, 'TICKET_NOT_ACTIVE');
    return this.db.query("UPDATE ticket SET sync_status='PENDING',sync_attempts=0,sync_at=now(),sync_error=NULL WHERE id=$1 AND private_channel_id IS NOT NULL AND sync_status IN ('FAILED','RETRY') RETURNING *", [id]);
  }
  async syncTickets() {
    await this.db.query("UPDATE ticket SET sync_status='PENDING',sync_at=now() WHERE sync_status='WORKING' AND sync_at<now()-interval '2 minutes'");
    const ticket = await this.db.transaction(async tx => {
      const [row] = await tx.query<Ticket>("SELECT * FROM ticket WHERE private_channel_id IS NOT NULL AND sync_status IN ('PENDING','RETRY') AND sync_at<=now() ORDER BY sync_at LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!row) return null;
      await tx.query("UPDATE ticket SET sync_status='WORKING',sync_at=now() WHERE id=$1", [row.id]);
      return row;
    });
    if (!ticket) return;
    try {
      await this.transport.syncTicket(ticket.private_channel_id!, ticket.card_message_id ? String(ticket.card_message_id) : null, { ...ticket, reopen_days: (await this.current()).body.reopenDays });
      const updated = await this.db.query("UPDATE ticket SET sync_status='SYNCED',sync_error=NULL,sync_attempts=0 WHERE id=$1 AND revision=$2 RETURNING id", [ticket.id, ticket.revision]);
      if (!updated.length) await this.db.query("UPDATE ticket SET sync_status='PENDING',sync_at=now() WHERE id=$1 AND revision<>$2", [ticket.id, ticket.revision]);
    } catch {
      const attempts = Number(ticket.sync_attempts) + 1;
      await this.db.query("UPDATE ticket SET sync_status=$3,sync_error='TICKET_SYNC_FAILED',sync_attempts=$4,sync_at=now()+interval '30 seconds' WHERE id=$1 AND revision=$2", [ticket.id, ticket.revision, attempts >= 5 ? 'FAILED' : 'RETRY', attempts]);
    }
  }
  async publishTicketPanel(actor: Actor, replace = false) {
    this.require(actor, 'config');
    const config = (await this.current()).body;
    const channel = config.channels.helpDesk;
    if (!config.enabled.tickets || !channel || !config.channels.ticketCategory) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
    const panel = await this.db.transaction(async tx => {
      await tx.query('LOCK TABLE ticket_panel IN EXCLUSIVE MODE');
      const [old] = await tx.query('SELECT * FROM ticket_panel WHERE id=1');
      if (!replace && old && old.channel_id === channel && ['PUBLISHING','UNKNOWN'].includes(String(old.status)) && !old.message_id) throw new AppError(409, 'TICKET_PANEL_UNKNOWN');
      const messageId = !replace && old?.channel_id === channel ? old.message_id : null;
      await tx.query("INSERT INTO ticket_panel(id,channel_id,message_id,status) VALUES(1,$1,$2,'PUBLISHING') ON CONFLICT(id) DO UPDATE SET channel_id=$1,message_id=$2,status='PUBLISHING',updated_at=now()", [channel, messageId]);
      return { channel, messageId: messageId ? String(messageId) : null };
    });
    try {
      const messageId = await this.transport.publishTicketPanel(panel.channel, panel.messageId);
      await this.db.query("UPDATE ticket_panel SET message_id=$1,status='READY',updated_at=now() WHERE id=1", [messageId]);
      await this.audit(this.db, actor.id, 'ticket.panel_published', messageId, { channel });
      return { channel, messageId };
    } catch {
      await this.db.query("UPDATE ticket_panel SET status='UNKNOWN',updated_at=now() WHERE id=1");
      throw new AppError(502, 'TICKET_PANEL_UNKNOWN');
    }
  }
  async replyTicket(actor: Actor, id: string, input: unknown) {
    const data = z.object({ body: z.string().trim().min(1).max(1900), requestKey: z.string().uuid() }).strict().parse(input);
    return this.db.transaction(async tx => {
      const [ticket] = await tx.query<Ticket>('SELECT * FROM ticket WHERE id=$1 FOR UPDATE', [id]);
      if (!ticket || !this.ticketVisible(actor, ticket)) throw new AppError(404, 'TICKET_NOT_FOUND');
      const [existing] = await tx.query('SELECT * FROM ticket_reply WHERE id=$1', [data.requestKey]);
      if (existing) {
        if (existing.ticket_id !== id || existing.authored_by !== actor.id || existing.body !== data.body) throw new AppError(409, 'TICKET_REPLY_KEY_CONFLICT');
        return existing;
      }
      if (!['OPEN','INVESTIGATING','WAITING_USER','RESOLVED'].includes(ticket.status) || !ticket.private_channel_id) throw new AppError(409, 'TICKET_REPLY_CLOSED');
      const [reply] = await tx.query("INSERT INTO ticket_reply(id,ticket_id,authored_by,authored_role,body) VALUES($1,$2,$3,$4,$5) RETURNING *", [data.requestKey, id, actor.id, actor.role, data.body]);
      await tx.query('INSERT INTO ticket_event(id,ticket_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, actor.id, 'REPLY_QUEUED', JSON.stringify({ note: 'User-visible reply queued', reply_id: reply.id })]);
      await this.audit(tx, actor.id, 'ticket.reply_queued', id, { reply_id: reply.id });
      return reply;
    });
  }
  async sendTicketReply() {
    await this.db.query("UPDATE ticket_reply SET status='UNKNOWN',error_code='WORKER_INTERRUPTED' WHERE status='SENDING' AND updated_at<now()-interval '2 minutes'");
    const reply = await this.db.transaction(async tx => {
      const [row] = await tx.query("SELECT * FROM ticket_reply WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=now() AND ticket_id IN (SELECT id FROM ticket WHERE sync_status='SYNCED') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!row) return null;
      await tx.query("UPDATE ticket_reply SET status='SENDING',attempts=attempts+1,updated_at=now() WHERE id=$1", [row.id]);
      return row;
    });
    if (!reply) return;
    const [ticket] = await this.db.query<Ticket>('SELECT * FROM ticket WHERE id=$1', [reply.ticket_id]);
    if (!ticket || !ticket.private_channel_id || (reply.authored_role === 'SYSTEM' ? ticket.status !== reply.expected_status : !['OPEN','INVESTIGATING','WAITING_USER','RESOLVED'].includes(ticket.status)) || (reply.authored_role === 'SUPPORT' && reply.authored_by !== ticket.assigned_to && reply.authored_by !== ticket.creator_id)) {
      await this.db.query("UPDATE ticket_reply SET status='CANCELLED',error_code='TICKET_REPLY_NO_LONGER_AUTHORIZED',updated_at=now() WHERE id=$1", [reply.id]); return;
    }
    try {
      const messageId = await this.transport.send(ticket.private_channel_id, String(reply.body), String(reply.id));
      await this.db.query("UPDATE ticket_reply SET status='SENT',message_id=$2,updated_at=now() WHERE id=$1", [reply.id, messageId]);
    } catch (error) {
      const attempts = Number(reply.attempts) + 1;
      const failure = error instanceof DeliveryError ? error : new DeliveryError('TICKET_REPLY_UNKNOWN', 'ambiguous');
      const status = failure.kind === 'ambiguous' ? 'UNKNOWN' : failure.kind === 'retry' && attempts < 5 ? 'RETRY' : 'FAILED';
      await this.db.query("UPDATE ticket_reply SET status=$2,error_code=$3,next_attempt_at=now()+$4*interval '1 second',updated_at=now() WHERE id=$1", [reply.id, status, failure.code, Math.max(5, failure.retryAfter)]);
    }
  }
  async awardTicket(actor: Actor, id: string, input: unknown) {
    this.require(actor, 'publish');
    const { reason, confirm } = z.object({ reason: z.string().trim().min(5).max(500), confirm: z.literal(true) }).strict().parse(input);
    if (!confirm) throw new AppError(400, 'CONFIRM_REQUIRED');
    const ticket = await this.ticket(actor, id);
    if (!['Bug','Feature Request'].includes(ticket.category as string)) throw new AppError(409, 'TICKET_NOT_ISSUE');
    const result = await this.xp.reviewed(actor, { userId: ticket.creator_id, event: 'confirmed_issue', source: `ticket:${ticket.id}`, reason });
    if (result.awarded) await this.db.query('INSERT INTO ticket_event(id,ticket_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, actor.id, 'ISSUE_CONFIRMED', JSON.stringify({ note: reason, amount: result.amount })]);
    return result;
  }
  async welcome(user: string, joinedAt: Date, completed: boolean, startedAt: Date, appearance: WelcomeAppearance = {}) {
    const { body: c } = await this.current();
    if (!completed || joinedAt < startedAt || !c.enabled.welcome || !c.channels.welcome) return false;
    const rows = await this.db.query("INSERT INTO member_state(user_id,joined_at,welcome_status) VALUES($1,$2,'SENDING') ON CONFLICT(user_id) DO NOTHING RETURNING user_id", [user, joinedAt]);
    if (!rows.length) return false;
    try {
      // Only the welcomed member may be mentioned; the card buttons are the primary entry points.
      const id = await this.transport.send(c.channels.welcome, c.persona.welcome.replaceAll('{user}', `<@${user}>`), randomUUID(), { ...appearance, welcomeCard: true, mentionUser: user });
      await this.db.query("UPDATE member_state SET welcome_status='SENT',message_id=$2 WHERE user_id=$1", [user, id]);
      return true;
    } catch {
      await this.db.query("UPDATE member_state SET welcome_status='UNKNOWN' WHERE user_id=$1", [user]);
      return false; // No blind retry of a possibly accepted send.
    }
  }
  async createJob(actor: Actor, input: unknown) {
    this.require(actor, 'publish');
    const data = z.object({ channelId: z.string().regex(/^\d{17,20}$/), body: z.string().trim().min(1).max(1900), scheduledAt: z.string().datetime({ offset: true }) }).strict().parse(input);
    const { body: c, version } = await this.current();
    if (!c.enabled.messaging || !c.channels.publish.includes(data.channelId)) throw new AppError(409, 'CHANNEL_NOT_APPROVED');
    if (Date.parse(data.scheduledAt) < Date.now() - 60000) throw new AppError(400, 'SCHEDULE_IN_PAST');
    return this.db.transaction(async tx => {
      const [job] = await tx.query("INSERT INTO message_job(id,channel_id,body,scheduled_at,status,authored_by,config_version) VALUES($1,$2,$3,$4,'DRAFT',$5,$6) RETURNING *", [randomUUID(), data.channelId, data.body, data.scheduledAt, actor.id, version]);
      await this.audit(tx, actor.id, 'message.drafted', String(job.id));
      return job;
    });
  }
  async confirmJob(actor: Actor, id: string) {
    this.require(actor, 'publish');
    return this.db.transaction(async tx => {
      const [job] = await tx.query("UPDATE message_job SET status='SCHEDULED',approved_by=$2 WHERE id=$1 AND status='DRAFT' RETURNING *", [id, actor.id]);
      if (!job) throw new AppError(409, 'JOB_NOT_DRAFT');
      await tx.query("INSERT INTO message_delivery(id,job_id,delivery_key,status) VALUES($1,$2,$3,'PENDING')", [randomUUID(), id, id]);
      await this.audit(tx, actor.id, 'message.confirmed', id);
      return job;
    });
  }
  async cancelJob(actor: Actor, id: string) {
    this.require(actor, 'publish');
    return this.db.transaction(async tx => {
      const [job] = await tx.query("UPDATE message_job SET status='CANCELLED' WHERE id=$1 AND status IN ('DRAFT','SCHEDULED','RETRY') RETURNING *", [id]);
      if (!job) throw new AppError(409, 'JOB_CANNOT_CANCEL');
      await this.audit(tx, actor.id, 'message.cancelled', id);
      return job;
    });
  }
  async tick() {
    await this.syncTickets();
    await this.sendTicketReply();
    // Recover crashed sends conservatively. UNKNOWN is visible to operators, never auto-replayed.
    await this.db.query("UPDATE message_delivery SET status='UNKNOWN',error_code='WORKER_INTERRUPTED' WHERE status='SENDING' AND updated_at < now()-interval '2 minutes'");
    await this.db.query("UPDATE message_job SET status='UNKNOWN' WHERE status='SENDING' AND id IN (SELECT job_id FROM message_delivery WHERE status='UNKNOWN')");
    const claim = await this.db.transaction(async tx => {
      const [row] = await tx.query("SELECT j.*,d.attempts,d.delivery_key FROM message_job j JOIN message_delivery d ON d.job_id=j.id WHERE j.status IN ('SCHEDULED','RETRY') AND j.scheduled_at<=now() AND d.next_attempt_at<=now() AND d.status IN ('PENDING','RETRY') ORDER BY j.scheduled_at LIMIT 1 FOR UPDATE OF j,d SKIP LOCKED");
      if (!row) return null;
      await tx.query("UPDATE message_job SET status='SENDING' WHERE id=$1", [row.id]);
      await tx.query("UPDATE message_delivery SET status='SENDING',attempts=attempts+1,updated_at=now() WHERE job_id=$1", [row.id]);
      return row;
    });
    if (!claim) return;
    const id = String(claim.id);
    try {
      const { body: c } = await this.current();
      if (!c.enabled.messaging || !c.channels.publish.includes(String(claim.channel_id))) throw new DeliveryError('CHANNEL_APPROVAL_REVOKED', 'permanent');
      const messageId = await this.transport.send(String(claim.channel_id), String(claim.body), String(claim.delivery_key));
      await this.db.transaction(async tx => {
        await tx.query("UPDATE message_job SET status='SENT' WHERE id=$1", [id]);
        await tx.query("UPDATE message_delivery SET status='SENT',discord_message_id=$2,updated_at=now() WHERE job_id=$1", [id, messageId]);
        await this.audit(tx, 'worker', 'message.delivered', id);
      });
    } catch (e) {
      const err = e instanceof DeliveryError ? e : e instanceof AppError ? new DeliveryError(e.code, 'permanent') : new DeliveryError('DELIVERY_OUTCOME_UNKNOWN', 'ambiguous');
      const attempts = Number(claim.attempts) + 1;
      const status = err.kind === 'ambiguous' ? 'UNKNOWN' : err.kind === 'retry' && attempts < 5 ? 'RETRY' : 'FAILED';
      const seconds = Math.max(err.retryAfter, Math.min(300, 2 ** attempts));
      await this.db.transaction(async tx => {
        await tx.query('UPDATE message_job SET status=$2 WHERE id=$1', [id, status]);
        await tx.query("UPDATE message_delivery SET status=$2,error_code=$3,next_attempt_at=now()+$4*interval '1 second',updated_at=now() WHERE job_id=$1", [id, status, err.code, seconds]);
        await this.audit(tx, 'worker', 'message.delivery_error', id, { status, code: err.code });
      });
    }
  }
  async dashboard(actor: Actor) {
    const tickets = await this.tickets(actor);
    const counts = actor.role === 'SUPPORT' ? [] : await this.db.query('SELECT status,count(*)::int AS count FROM message_job GROUP BY status');
    return { mode: this.mock ? 'MOCK' : 'DISCORD', phase: (await this.current()).body.phase,
      openTickets: tickets.filter(t => !['CLOSED', 'FAILED', 'RESOLVED'].includes(t.status)).length,
      messages: counts, ai: 'TEMPLATE_FALLBACK', xp: (await this.xp.current()).body.enabled ? 'ENABLED' : 'DISABLED', insights: 'NOT_IMPLEMENTED',
      warnings: ['Brand assets missing: placeholder only', 'DM, recurrence and automated moderation are disabled', 'XP and Boost require approved published rules; message scoring also needs Message Content Intent'],
    };
  }
}

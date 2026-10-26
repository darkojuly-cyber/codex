import { randomUUID, randomInt } from 'node:crypto';
import type { Database, Queryable } from '../../db/src.js';
import { AppError, can, configSchema, defaults, type Actor, type Config } from './config.js';
import { DeliveryError, type Transport } from './transport.js';
import { exampleSeeds } from './seeds.js';
import { z } from 'zod';
import { TemplatePromptProvider, type PromptProvider } from '../../ai-adapter/src.js';
import type { WelcomeAppearance } from './welcome-card.js';
import { XpService } from './xp.js';

export type Row = Record<string, unknown>;
type Revision = Row & { id: string; version: number; body: Config; status: string };
export type Ticket = Row & { id: string; seq: number; creator_id: string; assigned_to: string | null; private_channel_id: string | null; status: string; closed_at: Date | null };
const ticketInput = z.object({ category: z.enum(['Bug', 'Creation Help', 'Account', 'Feature Request', 'Event', 'Other']), summary: z.string().trim().min(5).max(120), description: z.string().trim().min(10).max(3000) }).strict();

export class CommunityService {
  readonly xp: XpService;
  constructor(readonly db: Database, readonly transport: Transport, readonly mock = true, readonly prompts: PromptProvider = new TemplatePromptProvider()) { this.xp = new XpService(db, transport.xpParticipant?.bind(transport)); }
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
  async ticket(actor: Actor, id: string) {
    const [ticket] = await this.db.query<Ticket>('SELECT * FROM ticket WHERE id=$1', [id]);
    if (!ticket || !this.ticketVisible(actor, ticket)) throw new AppError(404, 'TICKET_NOT_FOUND');
    return { ...ticket, events: await this.db.query('SELECT * FROM ticket_event WHERE ticket_id=$1 ORDER BY created_at', [id]) };
  }
  async createTicket(user: string, requestKey: string, input: unknown) {
    const data = ticketInput.parse(input);
    const ticket = await this.db.transaction(async tx => {
      const { body: c } = await this.current(tx, true);
      const [existing] = await tx.query<Ticket>('SELECT * FROM ticket WHERE request_key=$1 AND creator_id=$2', [requestKey, user]);
      if (existing) return existing;
      if (!this.mock && (!c.enabled.tickets || !c.channels.ticketCategory)) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
      const [count] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM ticket WHERE creator_id=$1 AND status NOT IN ('CLOSED','FAILED')", [user]);
      if (Number(count.count) >= c.ticketLimit) throw new AppError(429, 'ACTIVE_TICKET_LIMIT');
      const [created] = await tx.query<Ticket>("INSERT INTO ticket(id,request_key,creator_id,category,summary,description,phase,status) VALUES($1,$2,$3,$4,$5,$6,$7,'CREATING') RETURNING *", [randomUUID(), requestKey, user, data.category, data.summary, data.description, c.phase]);
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
      await this.transport.send(channel, `Ticket #${ticket.seq}\n${data.summary}\n${data.description.slice(0, 1500)}\nPlease attach screenshots here if needed. Our support team will review your request.`, ticket.id);
      return await this.db.transaction(async tx => {
        const [opened] = await tx.query<Ticket>("UPDATE ticket SET status='OPEN',private_channel_id=$2 WHERE id=$1 RETURNING *", [ticket.id, channel]);
        await this.audit(tx, user, 'ticket.created', ticket.id);
        await this.event(tx, 'ticket.created', `ticket:${ticket.id}`, { ticket_id: ticket.id });
        return opened;
      });
    } catch (e) {
      let errorCode = e instanceof AppError ? e.code : 'PRIVATE_CHANNEL_PROVISION_FAILED';
      if (channel) {
        try { await this.transport.deleteTicket(channel); }
        catch { errorCode = 'PRIVATE_CHANNEL_CLEANUP_REQUIRED'; }
      }
      await this.db.query("UPDATE ticket SET status='FAILED',error_code=$2,private_channel_id=$3 WHERE id=$1", [ticket.id, errorCode, channel ?? null]);
      await this.audit(this.db, user, 'ticket.provision_failed', ticket.id, { error_code: errorCode });
      throw new AppError(502, errorCode);
    }
  }
  async updateTicket(actor: Actor, id: string, input: unknown) {
    const data = z.object({ status: z.enum(['OPEN', 'INVESTIGATING', 'WAITING_USER', 'RESOLVED', 'CLOSED']), note: z.string().trim().min(3).max(1000), assignedTo: z.string().max(30).optional() }).strict().parse(input);
    return this.db.transaction(async tx => {
      const { body: c } = await this.current(tx, true);
      const [ticket] = await tx.query<Ticket>('SELECT * FROM ticket WHERE id=$1 FOR UPDATE', [id]);
      if (!ticket || !this.ticketVisible(actor, ticket)) throw new AppError(404, 'TICKET_NOT_FOUND');
      if (['CREATING', 'PROVISIONING', 'FAILED'].includes(ticket.status)) throw new AppError(409, 'TICKET_NOT_ACTIVE');
      if (actor.role === 'SUPPORT' && data.assignedTo && data.assignedTo !== actor.id) throw new AppError(403, 'CANNOT_REASSIGN');
      if (ticket.status === 'CLOSED' && data.status !== 'CLOSED') {
        if (data.status !== 'OPEN' || !ticket.closed_at || Date.now() - new Date(ticket.closed_at).getTime() > c.reopenDays * 86400000) throw new AppError(409, 'REOPEN_WINDOW_EXPIRED');
        const [count] = await tx.query<{ count: string } & Row>("SELECT count(*) FROM ticket WHERE creator_id=$1 AND status NOT IN ('CLOSED','FAILED')", [ticket.creator_id]);
        if (Number(count.count) >= c.ticketLimit) throw new AppError(409, 'ACTIVE_TICKET_LIMIT');
      }
      const [updated] = await tx.query<Ticket>("UPDATE ticket SET status=$2,assigned_to=COALESCE($3,assigned_to),closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [id, data.status, data.assignedTo || null]);
      await tx.query('INSERT INTO ticket_event(id,ticket_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, actor.id, data.status, JSON.stringify({ note: data.note })]);
      await this.audit(tx, actor.id, 'ticket.updated', id, { status: data.status });
      return updated;
    });
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

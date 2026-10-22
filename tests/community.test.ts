import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REST } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, type Database } from '../packages/db/src.js';
import { CommunityService } from '../packages/core/src/service.js';
import { MockTransport, DeliveryError, DiscordTransport } from '../packages/core/src/transport.js';
import { defaults, configSchema, ctas, type Actor, type Config } from '../packages/core/src/config.js';
import { readEnv } from '../packages/core/src/env.js';
import { createApp } from '../apps/api/src/app.js';

let db: Database;
let service: CommunityService;
let transport: MockTransport;
const admin: Actor = { id: 'admin', role: 'SUPER_ADMIN' };
const mod: Actor = { id: 'mod', role: 'MODERATOR' };
const support: Actor = { id: 'support', role: 'SUPPORT' };
const input = { category: 'Bug', summary: 'Game freezes after start', description: 'Clicking start twice freezes the game in a desktop browser.' };
const channel = '123456789012345678';

async function publish(change: (c: Config) => void) {
  const current = await service.current();
  const config = structuredClone(current.body); change(config);
  const draft = await service.createDraft(admin, config);
  return service.publish(admin, draft.id, current.version);
}
async function message() {
  await publish(c => { c.enabled.messaging = true; c.channels.publish = [channel]; });
  const job = await service.createJob(admin, { channelId: channel, body: '@everyone hello', scheduledAt: new Date().toISOString() });
  await service.confirmJob(admin, String(job.id)); return job;
}
beforeAll(async () => { db = await openDatabase(process.env.TEST_DATABASE_URL, 'memory://'); await migrate(db); });
afterAll(async () => { await db.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.query('TRUNCATE config_revision,audit_log,admin_session,oauth_state,member_state,idea_seed,idea_draw,prompt_generation,ticket,ticket_event,message_job,message_delivery,event_outbox RESTART IDENTITY CASCADE');
  transport = new MockTransport(); service = new CommunityService(db, transport); await service.initialize();
});

describe('versioned configuration and lifecycle', () => {
  it('starts safe and cannot expose prelaunch product CTAs', async () => {
    expect((await service.current()).body).toEqual(defaults);
    expect(ctas(defaults)).toEqual([]);
    expect(configSchema.safeParse({ ...defaults, enabled: { ...defaults.enabled, web: true } }).success).toBe(false);
  });
  it('rejects javascript, HTTP and credential-bearing URLs', () => {
    for (const intro of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) expect(configSchema.safeParse({ ...defaults, links: { ...defaults.links, intro } }).success).toBe(false);
  });
  it('publishes valid web CTAs and omits unconfigured stores', async () => {
    await publish(c => { c.phase = 'WEB_LIVE'; c.links.web = 'https://example.com/create'; c.enabled.web = true; });
    expect(ctas((await service.current()).body)).toEqual([{ label: 'Create on Web', url: 'https://example.com/create' }]);
    await publish(c => { c.phase = 'APP_LIVE'; });
    expect(ctas((await service.current()).body)).toHaveLength(1);
  });
  it('rejects moderators changing config, preserves historical revisions and creates rollback drafts', async () => {
    await expect(service.createDraft(mod, defaults)).rejects.toMatchObject({ status: 403 });
    const old = await service.current();
    await publish(c => { c.persona.name = 'Mimo Buddy'; });
    const rollback = await service.rollback(admin, old.id);
    expect(rollback.status).toBe('DRAFT'); expect(rollback.body.persona.name).toBe('Mimo');
    expect((await service.current()).body.persona.name).toBe('Mimo Buddy');
    expect(await db.query('SELECT * FROM audit_log')).toHaveLength(3);
  });
  it('rejects stale publish rather than silently overwriting changes', async () => {
    const draft = await service.createDraft(admin, defaults);
    const old = await service.current(); await publish(c => { c.ticketLimit = 3; });
    await expect(service.publish(admin, draft.id, old.version)).rejects.toMatchObject({ code: 'CONFIG_CHANGED_RELOAD' });
  });
});

describe('private tickets', () => {
  it('uses private channels, persists long descriptions, and deduplicates repeated submissions', async () => {
    const ticket = await service.createTicket('alice', 'request-1', { ...input, description: 'Details '.repeat(350) });
    const repeated = await service.createTicket('alice', 'request-1', input);
    expect(repeated.id).toBe(ticket.id); expect(transport.channels.size).toBe(1);
    expect(transport.channels.get(ticket.private_channel_id!)?.private).toBe(true);
    expect(String(transport.sent[0].body).length).toBeLessThan(2000);
  });
  it('enforces concurrent active ticket cap', async () => {
    const results = await Promise.allSettled([1,2,3].map(i => service.createTicket('alice', `request-${i}`, input)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(transport.channels.size).toBe(2);
  });
  it('does not reveal private tickets to unrelated support accounts, even with guessed IDs', async () => {
    const ticket = await service.createTicket('alice', 'request-1', input);
    expect(await service.tickets(support)).toHaveLength(0);
    await expect(service.ticket(support, ticket.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.updateTicket(support, ticket.id, { status: 'CLOSED', note: 'Guessing a ticket ID' })).rejects.toMatchObject({ status: 404 });
    await service.updateTicket(admin, ticket.id, { status: 'INVESTIGATING', note: 'Assigned for review', assignedTo: support.id });
    expect((await service.ticket(support, ticket.id)).status).toBe('INVESTIGATING');
  });
  it('cleans up a private channel after initial message failure and never falls back to public', async () => {
    transport.send = async () => { throw new Error('Network failed'); };
    await expect(service.createTicket('alice', 'request-1', input)).rejects.toMatchObject({ status: 502 });
    expect(transport.channels.size).toBe(0);
    expect((await db.query('SELECT status FROM ticket'))[0].status).toBe('FAILED');
  });
  it('denies live ticket creation without approved configuration', async () => {
    const live = new CommunityService(db, transport, false);
    await expect(live.createTicket('alice', 'live-request', input)).rejects.toMatchObject({ code: 'TICKETS_PENDING_APPROVAL' });
    expect(transport.channels.size).toBe(0);
  });
  it('rejects invalid form input, supports close and controlled reopen', async () => {
    await expect(service.createTicket('alice', 'bad', { ...input, summary: '' })).rejects.toThrow();
    const ticket = await service.createTicket('alice', 'request-1', input);
    await service.updateTicket(admin, ticket.id, { status: 'CLOSED', note: 'Closed after user confirmation' });
    expect((await service.updateTicket(admin, ticket.id, { status: 'OPEN', note: 'User supplied new information' })).status).toBe('OPEN');
  });
});

describe('welcome and Idea Machine', () => {
  it('welcomes only completed new members, exactly once across restart and replay', async () => {
    await publish(c => { c.enabled.welcome = true; c.channels.welcome = channel; });
    const cutoff = new Date(Date.now() - 10000); const joined = new Date();
    expect(await service.welcome('alice', joined, false, cutoff)).toBe(false);
    expect(await service.welcome('historic', new Date(0), true, cutoff)).toBe(false);
    expect(await service.welcome('alice', joined, true, cutoff)).toBe(true);
    const restarted = new CommunityService(db, transport); await restarted.initialize();
    expect(await restarted.welcome('alice', joined, true, cutoff)).toBe(false);
    expect(transport.sent).toHaveLength(1);
  });
  it('uses a safe fallback with every required playable-game component', async () => {
    const idea = await service.idea('alice');
    const prompt = await service.prompt('alice', String(idea.id));
    for (const term of ['Title:', 'Core gameplay:', 'Controls:', 'Goal & end:', 'Scoring & feedback:', '3 minutes', 'Style:', 'Compatibility:', 'Results:']) expect(prompt.generated_prompt).toContain(term);
  });
  it('enforces daily user limits and avoids recently generated seeds', async () => {
    await publish(c => { c.promptDailyLimit = 1; });
    const idea = await service.idea('alice'); await service.prompt('alice', String(idea.id));
    expect((await service.idea('alice')).id).not.toBe(idea.id);
    await expect(service.prompt('alice', String(idea.id))).rejects.toMatchObject({ status: 429 });
  });
  it('does not expose unreviewed production seeds', async () => {
    await db.query('TRUNCATE prompt_generation,idea_seed CASCADE');
    const live = new CommunityService(db, transport, false); await live.initialize();
    await expect(live.idea('alice')).rejects.toMatchObject({ code: 'NO_APPROVED_SEEDS' });
  });
  it('falls back to complete templates when an optional provider fails', async () => {
    const unavailable = new CommunityService(db, transport, true, { name: 'UNAVAILABLE_TEST_PROVIDER', generate: async () => { throw new Error('Provider unavailable'); } });
    const seed = await unavailable.idea('alice');
    expect((await unavailable.prompt('alice', String(seed.id))).generated_prompt).toContain('Core gameplay:');
  });
});

describe('durable channel messaging', () => {
  it('requires a draft confirmation and an approved channel', async () => {
    await expect(service.createJob(admin, { channelId: channel, body: 'Hi', scheduledAt: new Date().toISOString() })).rejects.toMatchObject({ code: 'CHANNEL_NOT_APPROVED' });
    await publish(c => { c.enabled.messaging = true; c.channels.publish = [channel]; });
    await service.createJob(admin, { channelId: channel, body: 'Hi', scheduledAt: new Date().toISOString() });
    await service.tick(); expect(transport.sent).toHaveLength(0);
  });
  it('survives a new service instance and delivers once under simultaneous workers', async () => {
    await message();
    const restarted = new CommunityService(db, transport);
    await Promise.all([service.tick(), restarted.tick()]); await restarted.tick();
    expect(transport.sent).toHaveLength(1);
    expect((await db.query('SELECT status FROM message_job'))[0].status).toBe('SENT');
  });
  it('does not send cancelled or future jobs', async () => {
    const job = await message(); await service.cancelJob(admin, String(job.id));
    const future = await service.createJob(admin, { channelId: channel, body: 'Tomorrow', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    await service.confirmJob(admin, String(future.id)); await service.tick();
    expect(transport.sent).toHaveLength(0);
  });
  it('honors retry-after on 429, preserving attempt and delivery state', async () => {
    const job = await message();
    const send = transport.send.bind(transport); let calls = 0;
    transport.send = async (...args) => { if (++calls === 1) throw new DeliveryError('RATE_LIMITED', 'retry', 60); return send(...args); };
    await service.tick(); await service.tick();
    expect(calls).toBe(1);
    const [delivery] = await db.query('SELECT * FROM message_delivery');
    expect(delivery.status).toBe('RETRY');
    expect(new Date(String(delivery.next_attempt_at)).getTime()).toBeGreaterThan(Date.now() + 50000);
    await db.query("UPDATE message_delivery SET next_attempt_at=now()-interval '1 second' WHERE job_id=$1", [job.id]);
    await service.tick(); expect(transport.sent).toHaveLength(1);
  });
  it('records ambiguous outcomes for manual reconciliation without resending', async () => {
    await message(); transport.send = async () => { throw new DeliveryError('DELIVERY_OUTCOME_UNKNOWN', 'ambiguous'); };
    await service.tick(); await service.tick();
    expect((await db.query('SELECT status FROM message_delivery'))[0].status).toBe('UNKNOWN');
  });
  it('checks channel approval again immediately before delivery', async () => {
    await message(); await publish(c => { c.enabled.messaging = false; }); await service.tick();
    expect(transport.sent).toHaveLength(0); expect((await db.query('SELECT error_code FROM message_delivery'))[0].error_code).toBe('CHANNEL_APPROVAL_REVOKED');
  });
  it('forces allowed_mentions empty in the real Discord adapter', async () => {
    const env = { ...readEnv(), DISCORD_WRITES_ENABLED: 'true' as const, DISCORD_TOKEN: 'not-a-real-token' };
    const adapter = new DiscordTransport(env);
    let payload: unknown;
    adapter.rest.get = (async () => ({ guild_id: env.DISCORD_GUILD_ID, type: 0 })) as typeof adapter.rest.get;
    adapter.rest.post = (async (_route: unknown, options: unknown) => { payload = options; return { id: 'sent-id' }; }) as typeof adapter.rest.post;
    await adapter.send(channel, '@everyone @here <@&123456789012345678>', randomUUID());
    expect(payload).toMatchObject({ body: { allowed_mentions: { parse: [], users: [], roles: [] }, enforce_nonce: true } });
  });
});

describe('server authorization, sessions, CSRF and input boundaries', () => {
  async function appSession(role: Actor['role'] = 'SUPER_ADMIN') {
    const app = await createApp(service, readEnv());
    const login = await app.inject({ method: 'POST', url: '/api/auth/mock', headers: { origin: 'http://localhost:3000', host: 'localhost' }, payload: { role } });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return { app, headers: { cookie, origin: 'http://localhost:3000', host: 'localhost', 'x-csrf-token': login.json().csrf } };
  }
  it('denies unauthenticated management access and ordinary role injection', async () => {
    const app = await createApp(service, readEnv());
    expect((await app.inject({ url: '/api/tickets', headers: { host: 'localhost', 'x-role': 'SUPER_ADMIN' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/mock', headers: { host: 'localhost', origin: 'http://localhost:3000' }, payload: { role: 'MEMBER' } })).statusCode).toBe(400);
    await app.close();
  });
  it('rejects missing CSRF, hostile origins and DNS-rebinding hosts', async () => {
    const { app, headers } = await appSession();
    expect((await app.inject({ method: 'POST', url: '/api/config/drafts', headers: { ...headers, 'x-csrf-token': '' }, payload: defaults })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/config/drafts', headers: { ...headers, origin: 'https://evil.example' }, payload: defaults })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/session', headers: { ...headers, host: 'evil.example' } })).statusCode).toBe(403);
    await app.close();
  });
  it('enforces Moderator and Support API boundaries', async () => {
    const { app, headers } = await appSession('MODERATOR');
    expect((await app.inject({ method: 'POST', url: '/api/config/drafts', headers, payload: defaults })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tickets', headers })).statusCode).toBe(200);
    await app.close();
    const other = await appSession('SUPPORT');
    expect((await other.app.inject({ url: '/api/audit', headers: other.headers })).statusCode).toBe(403);
    await other.app.close();
  });
  it('saves drafts through API, rejects malformed IDs and invalidates logout session', async () => {
    const { app, headers } = await appSession();
    expect((await app.inject({ method: 'POST', url: '/api/config/drafts', headers, payload: defaults })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/tickets/not-a-uuid', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/logout', headers, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
    await app.close();
  });
  it('does not expose mock login in Discord mode', async () => {
    const env = { ...readEnv(), APP_MODE: 'discord' as const };
    const app = await createApp(service, env);
    expect((await app.inject({ method: 'POST', url: '/api/auth/mock', headers: { origin: env.PUBLIC_ORIGIN }, payload: { role: 'SUPER_ADMIN' } })).statusCode).toBe(404);
    await app.close();
  });
  it('binds OAuth state to the browser, consumes it once, and rechecks roles on every request', async () => {
    const env = { ...readEnv(), APP_MODE: 'discord' as const, PUBLIC_ORIGIN: 'https://console.example.com', DISCORD_CLIENT_ID: channel,
      DISCORD_CLIENT_SECRET: 'test-only-client-secret', DISCORD_REDIRECT_URI: 'https://console.example.com/api/auth/callback', DISCORD_TOKEN: 'test-only-bot-token',
      DISCORD_GUILD_ID: channel, STAFF_ROLE_IDS: '223456789012345678' };
    let granted = true;
    vi.spyOn(REST.prototype, 'get').mockImplementation(async () => ({ roles: granted ? ['223456789012345678'] : [] }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'test-only-oauth-token' } : { id: '323456789012345678' }), { status: 200 })));
    const app = await createApp(service, env);
    const start = await app.inject({ url: '/api/auth/discord' });
    expect(start.statusCode).toBe(302);
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const stateCookie = start.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const callback = `/api/auth/callback?state=${state}&code=test-code`;
    expect((await app.inject({ url: callback })).statusCode).toBe(403);
    const loggedIn = await app.inject({ url: callback, headers: { cookie: stateCookie } });
    expect(loggedIn.statusCode).toBe(302);
    const sessionCookie = loggedIn.cookies.filter(c => c.name === '__Host-evomeme').map(c => `${c.name}=${c.value}`).join('; ');
    expect(loggedIn.cookies.find(c => c.name === '__Host-evomeme')).toMatchObject({ secure: true, httpOnly: true });
    expect((await app.inject({ url: '/api/config', headers: { cookie: sessionCookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: callback, headers: { cookie: stateCookie } })).statusCode).toBe(403);
    granted = false;
    expect((await app.inject({ url: '/api/config', headers: { cookie: sessionCookie } })).statusCode).toBe(403);
    await app.close();
  });
  it('creates real adapter tickets with explicit @everyone deny and only the bound staff and owner allowed', async () => {
    const guild = '123456789012345678'; const staff = '223456789012345678'; const owner = '323456789012345678'; const bot = '423456789012345678';
    const adapter = new DiscordTransport({ ...readEnv(), DISCORD_WRITES_ENABLED: 'true', DISCORD_TOKEN: 'test-only', DISCORD_GUILD_ID: guild, STAFF_ROLE_IDS: staff });
    adapter.rest.get = (async (route: string) => route.includes('/channels/') ? { type: 4, guild_id: guild } : { id: bot }) as typeof adapter.rest.get;
    let payload: unknown;
    adapter.rest.post = (async (_route: unknown, options: unknown) => { payload = options; return { id: '523456789012345678' }; }) as typeof adapter.rest.post;
    await adapter.createTicket(owner, '623456789012345678', 7);
    expect(payload).toMatchObject({ body: { parent_id: '623456789012345678', name: 'ticket-000007', permission_overwrites: [
      { id: guild, type: 0, deny: '1024', allow: '0' }, { id: staff, type: 0, deny: '0' }, { id: owner, type: 1, deny: '0' }, { id: bot, type: 1, deny: '0' },
    ] } });
  });
  it('never sends to a channel belonging to another guild', async () => {
    const adapter = new DiscordTransport({ ...readEnv(), DISCORD_WRITES_ENABLED: 'true', DISCORD_TOKEN: 'test-only', DISCORD_GUILD_ID: channel });
    adapter.rest.get = (async () => ({ type: 0, guild_id: '723456789012345678' })) as typeof adapter.rest.get;
    const post = vi.spyOn(adapter.rest, 'post');
    await expect(adapter.send(channel, 'Not allowed', randomUUID())).rejects.toMatchObject({ code: 'CHANNEL_OUTSIDE_GUILD' });
    expect(post).not.toHaveBeenCalled();
  });
});

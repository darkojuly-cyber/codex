import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, type Database } from '../packages/db/src.js';
import { XpService } from '../packages/core/src/xp.js';
import { xpConfigSchema, xpDefaults, evoPointsProposal, periodStart, type XpConfig } from '../packages/core/src/xp-config.js';
import { type Actor } from '../packages/core/src/config.js';
import { CommunityService } from '../packages/core/src/service.js';
import { MockTransport } from '../packages/core/src/transport.js';
import { readEnv } from '../packages/core/src/env.js';
import { ChannelType, type Message } from 'discord.js';
import { scoreGuildMessage } from '../apps/discord-bot/src/message-scope.js';
import { createApp } from '../apps/api/src/app.js';

let db: Database;
let xp: XpService;
const admin: Actor = { id: 'staff', role: 'SUPER_ADMIN' };
const mod: Actor = { id: 'mod', role: 'MODERATOR' };
const user = '123456789012345678';
const other = '223456789012345678';
const channel = '323456789012345678';
let messageNumber = 0;
function message(content: string, occurredAt = new Date()) {
  return { user, channelId: channel, messageId: String(423456789012345600n + BigInt(++messageNumber)), content, occurredAt, bot: false };
}
async function enable(change: (config: XpConfig) => void = () => {}) {
  const config = structuredClone(xpDefaults);
  config.enabled = true;
  for (const rule of config.rules) { rule.enabled = true; rule.channels = ['chat','first_message','official_discussion'].includes(rule.event) ? [channel] : []; }
  change(config);
  const current = await xp.current();
  const draft = await xp.draft(admin, { config, reason: 'Reviewed test configuration' });
  await xp.approve(admin, String(draft.id));
  const published = await xp.publish(admin, String(draft.id), current.version);
  // Deterministic historical event fixtures; production code never backdates publication.
  await db.query("UPDATE xp_rule_revision SET published_at='2026-01-01T00:00:00Z' WHERE id=$1", [published.id]);
  return published;
}
beforeAll(async () => { db = await openDatabase(process.env.TEST_DATABASE_URL, 'memory://'); await migrate(db); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE xp_ledger,xp_boost_state,xp_rule_revision RESTART IDENTITY CASCADE');
  xp = new XpService(db); await xp.initialize(); messageNumber = 0;
});

describe('XP rules, ledger and fairness', () => {
  it('stages the agreed Evo Points proposal without overwriting existing rules, channels, settings or balances', async () => {
    const old = structuredClone(xpDefaults);
    old.enabled = true; old.timezone = 'UTC'; old.levelThresholds = [0, 42, 500];
    old.rules.find(rule => rule.event === 'creation')!.points = 15;
    old.rules.find(rule => rule.event === 'creation')!.dailyCap = 15;
    old.rules.find(rule => rule.event === 'chat')!.channels = [channel];
    old.rules.find(rule => rule.event === 'chat')!.endsAt = '2030-01-01T00:00:00Z';
    await db.query("UPDATE xp_rule_revision SET body=$1 WHERE status='PUBLISHED'", [JSON.stringify(old)]);
    await xp.initialize();
    expect((await xp.current()).body).toEqual(old);
    await expect(xp.proposal(mod)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const staged = await xp.proposal(admin);
    const body = staged.body as XpConfig;
    expect(staged.status).toBe('DRAFT');
    expect(body.enabled).toBe(false);
    expect(body.timezone).toBe('UTC');
    expect(body.levelThresholds).toEqual([0, 42, 500]);
    expect(body.rules.find(rule => rule.event === 'chat')!.channels).toEqual([channel]);
    expect(body.rules.find(rule => rule.event === 'chat')!.endsAt).toBe('2030-01-01T00:00:00Z');
    expect(body.rules.filter(rule => rule.enabled).map(rule => [rule.event, rule.points, rule.dailyCap])).toEqual([
      ['first_message',10,10], ['chat',2,20], ['creation',5,20], ['confirmed_issue',3,18], ['featured',10,0], ['boost_first',20,20], ['boost_30d',30,30],
    ]);
    expect(body.rules.filter(rule => ['official_discussion','event'].includes(rule.event)).every(rule => !rule.enabled)).toBe(true);
    expect((await xp.current()).body).toEqual(old);
    expect((await xp.history(user))).toHaveLength(0);
    expect(evoPointsProposal(old)).toEqual(body);
  });

  it('scores new and uncategorized channels without binding IDs, excluding categories and announcements', async () => {
    const excluded = '1560526680613716068';
    await enable(c => { c.excludedCategoryIds = [excluded]; c.rules = c.rules.filter(r => ['first_message','chat'].includes(r.event)); c.rules.forEach(r => { r.channels = []; r.cooldownSeconds = 0; }); });
    const scope = { categoryId: null, announcement: false };
    expect((await xp.message({ ...message('A useful post in a restricted staff channel'), ...scope, categoryId: excluded })).reason).toBe('CHANNEL_NOT_ELIGIBLE');
    expect((await xp.message({ ...message('A useful announcement in some other category'), ...scope, announcement: true })).reason).toBe('CHANNEL_NOT_ELIGIBLE');
    expect((await xp.message(message('An unresolved parent must never receive points'))).reason).toBe('CHANNEL_METADATA_UNAVAILABLE');
    expect((await xp.message({ ...message('A first useful message in an uncategorized channel'), ...scope })).amount).toBe(10);
    expect((await xp.message({ ...message('A second useful message in a brand new channel'), ...scope, channelId: '623456789012345678', categoryId: '723456789012345678' })).amount).toBe(2);
    expect((await xp.summary(user)).lifetimeXp).toBe(12);
  });

  it('excludes the configured public points channel and its threads even outside excluded categories', async () => {
    await enable(c => { c.excludedCategoryIds = []; c.rules = c.rules.filter(r => ['first_message','chat'].includes(r.event)); });
    const options = { enabled: true, guildId: '923456789012345678', pointsChannelId: channel };
    const make = (id: string, parentId: string | null, thread: boolean) => ({
      id: String(823456789012345600n + BigInt(++messageNumber)), guildId: options.guildId, guild: {},
      author: { id: user, bot: false }, channelId: id, content: 'A meaningful message that should not farm points', createdAt: new Date(),
      channel: { isThread: () => thread, parentId, type: ChannelType.GuildText },
    }) as unknown as Message;
    await scoreGuildMessage(make(channel, null, false), xp, options);
    await scoreGuildMessage(make('723456789012345678', channel, true), xp, options);
    expect(await xp.history(user)).toHaveLength(0);
    await scoreGuildMessage(make('623456789012345678', null, false), xp, options);
    expect((await xp.summary(user)).lifetimeXp).toBe(10);
  });

  it('starts disabled and requires review, permission and an unchanged published version', async () => {
    expect((await xp.current()).body.enabled).toBe(false);
    const config = structuredClone(xpDefaults); config.enabled = true;
    await expect(xp.draft(mod, { config, reason: 'No permission' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const draft = await xp.draft(admin, { config, reason: 'Reviewed proposal' });
    await expect(xp.publish(admin, String(draft.id), 1)).rejects.toMatchObject({ code: 'XP_APPROVAL_REQUIRED' });
    await xp.approve(admin, String(draft.id));
    await expect(xp.publish(admin, String(draft.id), 999)).rejects.toMatchObject({ code: 'XP_CONFIG_CHANGED' });
    await xp.publish(admin, String(draft.id), 1);
    expect((await xp.current()).version).toBe(2);
    expect((await db.query("SELECT * FROM audit_log WHERE action='xp.rules_published' ORDER BY created_at DESC LIMIT 1"))[0].actor_id).toBe(admin.id);
    const invalid = structuredClone(config); invalid.levelThresholds = [0, 20, 10];
    expect(xpConfigSchema.safeParse(invalid).success).toBe(false);
    invalid.levelThresholds = [0]; invalid.rules.push(invalid.rules[0]);
    expect(xpConfigSchema.safeParse(invalid).success).toBe(false);
  });
  it('awards first meaningful message once, does not stack, and deduplicates concurrent replay across restart', async () => {
    await enable();
    const input = message('A genuinely useful first contribution about games');
    const results = await Promise.all(Array.from({ length: 10 }, () => xp.message(input)));
    expect(results.filter(r => r.awarded)).toHaveLength(1);
    expect((await xp.summary(user)).lifetimeXp).toBe(10);
    xp = new XpService(db); await xp.initialize();
    expect((await xp.message(input)).awarded).toBe(false);
    expect((await xp.message(message('Another distinct official discussion contribution'))).amount).toBe(5);
    const rows = await xp.history(user);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.event_kind).sort()).toEqual(['first_message', 'official_discussion']);
  });
  it('filters bots, short content, duplicate content and non-eligible channels, then enforces cooldown and clipped daily cap', async () => {
    await enable(c => { c.rules = c.rules.filter(r => r.event === 'chat'); c.rules[0].dailyCap = 5; });
    const start = new Date('2026-10-20T10:00:00Z');
    expect((await xp.message({ ...message('Useful contribution from a bot', start), bot: true })).awarded).toBe(false);
    expect((await xp.message(message('hi', start))).reason).toBe('MESSAGE_TOO_SHORT');
    expect((await xp.message({ ...message('Valid words in an unapproved channel', start), channelId: other })).awarded).toBe(false);
    expect((await xp.message(message('Helpful original game design explanation', start))).amount).toBe(2);
    expect((await xp.message(message('Fresh but too soon after last contribution', new Date(+start + 10000)))).reason).toBe('COOLDOWN');
    expect((await xp.message(message('  HELPFUL original game design explanation  ', new Date(+start + 60000)))).reason).toBe('REPEATED_CONTENT');
    expect((await xp.message(message('An entirely different accessibility idea', new Date(+start + 60000)))).amount).toBe(2);
    expect((await xp.message(message('Another useful explanation with new mechanics', new Date(+start + 120000)))).amount).toBe(1);
    expect((await xp.message(message('This has reached the maximum daily allowance', new Date(+start + 180000)))).reason).toBe('DAILY_CAP');
    const [stored] = await db.query('SELECT * FROM xp_ledger LIMIT 1');
    expect(String(stored.content_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('Helpful original');
  });
  it('uses configured local dates for caps and does not reset one-time rewards or rewrite XP when rules change', async () => {
    await enable(c => { c.rules = c.rules.filter(r => r.event === 'chat'); c.rules[0].dailyCap = 2; c.rules[0].cooldownSeconds = 0; });
    expect((await xp.message(message('Before the local midnight boundary starts', new Date('2026-10-20T15:59:00Z')))).amount).toBe(2);
    expect((await xp.message(message('After the local midnight boundary begins', new Date('2026-10-20T16:01:00Z')))).amount).toBe(2);
    const old = await xp.history(user);
    await enable(c => { c.rules = c.rules.filter(r => r.event === 'chat'); c.rules[0].points = 100; });
    expect((await xp.summary(user)).lifetimeXp).toBe(4);
    expect((await xp.history(user)).map(row => row.rule_version)).toEqual(old.map(row => row.rule_version));
    const current = await xp.current();
    await db.query('UPDATE xp_rule_revision SET published_at=now() WHERE id=$1', [current.id]);
    expect((await xp.message(message('Old messages cannot receive retroactive points', new Date('2026-10-19T00:00:00Z')))).reason).toBe('EVENT_OUTSIDE_RULE_VERSION');
  });
  it('records reviewed contributions once and rejects unapproved, inactive or expired rules', async () => {
    const data = { userId: user, event: 'creation', source: 'creation:12345', reason: 'Reviewed an original game submission' };
    expect((await xp.reviewed(admin, data)).reason).toBe('XP_DISABLED');
    await enable();
    expect((await xp.reviewed(admin, data)).amount).toBe(5);
    expect((await xp.reviewed(admin, data)).reason).toBe('DUPLICATE_EVENT');
    expect((await xp.reviewed(admin, { ...data, userId: other })).reason).toBe('DUPLICATE_EVENT');
    await expect(xp.reviewed(mod, { ...data, source: 'creation:54321' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await enable(c => { c.rules.find(r => r.event === 'event')!.endsAt = '2026-02-01T00:00:00Z'; });
    expect((await xp.reviewed(admin, { ...data, event: 'event', source: 'event:12345' })).reason).toBe('RULE_OUTSIDE_WINDOW');
  });
  it('makes signed corrections idempotent, audits the operator and never permits negative balances', async () => {
    await enable();
    const adjustment = { userId: user, amount: 100, requestKey: randomUUID(), reason: 'Correction for reviewed community contribution' };
    await Promise.all(Array.from({ length: 10 }, () => xp.adjust(admin, adjustment)));
    expect((await xp.summary(user)).lifetimeXp).toBe(100);
    expect((await xp.summary(user)).level).toBe(2);
    await expect(xp.adjust(admin, { ...adjustment, amount: 101 })).rejects.toMatchObject({ code: 'XP_IDEMPOTENCY_CONFLICT' });
    await expect(xp.adjust(admin, { ...adjustment, requestKey: randomUUID(), amount: -101 })).rejects.toMatchObject({ code: 'XP_INSUFFICIENT_BALANCE' });
    await xp.adjust(admin, { ...adjustment, requestKey: randomUUID(), amount: -30 });
    expect((await xp.summary(user)).lifetimeXp).toBe(70);
    const ledger = await xp.history(user);
    expect(ledger.map(row => Number(row.amount)).sort((a,b) => a-b)).toEqual([-30, 100]);
    expect((await db.query("SELECT actor_id FROM audit_log WHERE action='xp.adjusted' AND entity_id=$1", [ledger[0].id]))[0].actor_id).toBe(admin.id);
  });
  it('returns deterministic tied ranks, calendar periods, pagination and only the member’s own history', async () => {
    await enable();
    for (const target of [user, other]) await xp.adjust(admin, { userId: target, amount: 50, requestKey: randomUUID(), reason: 'A reviewed contribution for ranking' });
    const all = await xp.leaderboard('all_time');
    expect(all.entries.map(row => row.rank)).toEqual([1,1]);
    expect(all.entries.map(row => row.user_id)).toEqual([user,other]);
    expect((await xp.leaderboard('all_time', 2)).entries).toHaveLength(0);
    expect(await xp.history(user)).toHaveLength(1);
    expect(periodStart(new Date('2026-11-01T17:00:00Z'), 'weekly', 'Asia/Shanghai')).toBe('2026-11-02');
    expect(periodStart(new Date('2026-10-31T17:00:00Z'), 'monthly', 'Asia/Shanghai')).toBe('2026-11-01');
    expect(periodStart(new Date(), 'all_time', 'UTC')).toBeNull();
  });
});

describe('Boost qualification', () => {
  it('rechecks current membership, awards first once, ignores historical first bonuses and stops after cancellation', async () => {
    await enable();
    const since = new Date(Date.now() - 1000);
    await xp.observeBoost(user, since, true);
    const verify = vi.fn(async () => since);
    await xp.checkBoosts(verify);
    expect((await xp.summary(user)).lifetimeXp).toBe(20);
    await db.query('UPDATE xp_boost_state SET next_check_at=now() WHERE user_id=$1', [user]);
    await xp.checkBoosts(verify);
    expect((await xp.history(user))).toHaveLength(1);
    await xp.observeBoost(other, since, false);
    await xp.checkBoosts(async () => since);
    expect((await xp.summary(other)).lifetimeXp).toBe(0);
    await xp.observeBoost(user, null, false);
    await db.query('UPDATE xp_boost_state SET next_check_at=now() WHERE user_id=$1', [user]);
    verify.mockClear(); await xp.checkBoosts(verify);
    expect(verify).not.toHaveBeenCalled();
    expect((await xp.summary(user)).lifetimeXp).toBe(20);
  });
  it('awards only a verified full continuous cycle, never repeats it and does not infer awards from a failed lookup', async () => {
    await enable();
    const since = new Date(Date.now() - 31 * 86400000);
    await xp.observeBoost(user, since, false);
    await db.query('UPDATE xp_boost_state SET next_cycle_at=$2 WHERE user_id=$1', [user, new Date(+since + 30 * 86400000)]);
    await xp.checkBoosts(async () => { throw new Error('Network unavailable'); });
    expect((await db.query('SELECT last_error_code FROM xp_boost_state WHERE user_id=$1', [user]))[0].last_error_code).toBe('BOOST_LOOKUP_FAILED');
    await db.query('UPDATE xp_boost_state SET next_check_at=now() WHERE user_id=$1', [user]);
    expect((await xp.summary(user)).lifetimeXp).toBe(0);
    await xp.checkBoosts(async () => since);
    expect((await xp.summary(user)).lifetimeXp).toBe(30);
    await db.query('UPDATE xp_boost_state SET next_check_at=now() WHERE user_id=$1', [user]);
    await xp.checkBoosts(async () => since);
    expect(await xp.history(user)).toHaveLength(1);
    // A previously unawarded historical Booster can qualify on a newly observed Boost.
    await xp.observeBoost(user, null, false);
    const renewed = new Date();
    await xp.observeBoost(user, renewed, true);
    await xp.checkBoosts(async () => renewed);
    expect((await xp.summary(user)).lifetimeXp).toBe(50);
  });
});

it('protects XP APIs with authentication, roles, CSRF and origin checks', async () => {
  const service = new CommunityService(db, new MockTransport()); await service.initialize();
  const app = await createApp(service, { ...readEnv(), APP_MODE: 'mock', HOST: '127.0.0.1', PUBLIC_ORIGIN: 'http://localhost:3000' });
  try {
    expect((await app.inject('/api/xp/config')).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/mock', headers: { origin: 'http://localhost:3000' }, payload: { role: 'MODERATOR' } });
    const cookie = login.headers['set-cookie']!.toString().split(';')[0];
    const { csrf } = login.json();
    expect((await app.inject({ url: '/api/xp/config', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/xp/rules', headers: { cookie } })).statusCode).toBe(200);
    const payload = { userId: user, amount: 10, requestKey: randomUUID(), reason: 'Unauthorized attempt' };
    expect((await app.inject({ method: 'POST', url: '/api/xp/adjustments', headers: { cookie, origin: 'http://localhost:3000', 'x-csrf-token': csrf }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/xp/drafts', headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': csrf }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/xp/drafts', headers: { cookie, origin: 'http://localhost:3000' }, payload: {} })).statusCode).toBe(403);
    const health = await Promise.all(Array.from({ length: 100 }, () => app.inject('/api/health')));
    expect(health.every(response => response.statusCode === 200)).toBe(true);
    expect((await app.inject('/api/health')).statusCode).toBe(429);
    expect((await app.inject({ url: '/api/xp/rules', headers: { cookie } })).statusCode).toBe(200);
  } finally { await app.close(); }
});

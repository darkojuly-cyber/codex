import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel, type GuildMember } from 'discord.js';
import { openDatabase, migrate, type Database } from '../packages/db/src.js';
import { Operations } from '../packages/core/src/operations.js';
import { MockTransport } from '../packages/core/src/transport.js';
import { publicHistoryChannel, recoverChannelMessages, recoverGuildMessages, type HistoryMessage } from '../apps/discord-bot/src/message-recovery.js';

let db: Database, ops: Operations;
const channel = '123456789012345678';
const user = '223456789012345678';
const actor = { id: user, role: 'SUPER_ADMIN' as const };
beforeAll(async () => { db = await openDatabase(undefined, 'memory://'); await migrate(db); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE community_message_recovery,community_lifetime,community_lifetime_speaker,community_capture_minute,community_event,operations_settings,gateway_observation,ticket,risk_signal CASCADE');
  ops = new Operations(db, new MockTransport(), true); await ops.initialize();
  await ops.heartbeat(true, true, false);
  await db.query("UPDATE gateway_observation SET started_at=now()-interval '7 days'");
});
function message(id = '323456789012345678', days = 2): HistoryMessage {
  return { id, user, at: new Date(Date.now() - days * 86400000), bot: false, system: false, webhook: false };
}
it('recovers metadata on the original day, deduplicates live delivery and retains unique speakers', async () => {
  const first = message();
  await ops.message({ ...first, channel, category: null, parent: null });
  const live = vi.spyOn(ops, 'message');
  const second = { ...message('323456789012345679', 1), user: '423456789012345678' };
  expect((await recoverChannelMessages(ops, channel, null, async () => [first, second, { ...second }])).recovered).toBe(1);
  expect((await recoverChannelMessages(ops, channel, null, async () => [first, second])).recovered).toBe(0);
  expect(live).not.toHaveBeenCalled();
  expect(await db.query('SELECT * FROM risk_signal')).toHaveLength(0);
  const view = await ops.overview(actor, 7, 'UTC');
  expect(view.totals).toEqual({ joins: 0, leaves: 0, messages: 2, speakers: 2 });
  expect(view.lifetime).toMatchObject({ messages: 2, speakers: 2 });
  expect(view.daily.find(day => day.day === second.at.toISOString().slice(0, 10))).toMatchObject({ messages: 1, speakers: 1, joins: null, leaves: null });
  await ops.message({ ...second, channel, category: null, parent: null });
  expect((await ops.overview(actor, 7, 'UTC')).lifetime.messages).toBe(2);
  const [stored] = await db.query('SELECT * FROM community_event WHERE event_key=$1', [second.id]);
  expect(stored.recovered).toBe(true);
  expect(stored).not.toHaveProperty('content');
});
it('excludes bots, system messages, webhooks and out-of-window messages', async () => {
  const page = [message(), { ...message('323456789012345679'), bot: true }, { ...message('323456789012345680'), system: true }, { ...message('323456789012345681'), webhook: true }, message('323456789012345682', 8), message('323456789012345683', -1)];
  expect((await recoverChannelMessages(ops, channel, null, async () => page)).recovered).toBe(1);
  expect((await ops.overview(actor, 7, 'UTC')).lifetime.messages).toBe(1);
});
it('keeps failed channel checkpoints, paginates backwards and safely replays saved pages', async () => {
  const window = await ops.messageRecoveryWindow(channel);
  const page = Array.from({ length: 100 }, (_, i) => message(String(323456789012345678n + BigInt(i))));
  const list = vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('connection lost'));
  await expect(recoverChannelMessages(ops, channel, null, list)).rejects.toThrow('connection lost');
  expect(list.mock.calls[1][0]).toBe(page[0].id);
  expect((await ops.messageRecoveryWindow(channel)).since).toEqual(window.since);
  const retry = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([message('323456789012345677')]);
  expect((await recoverChannelMessages(ops, channel, null, retry)).recovered).toBe(1);
  expect((await ops.messageRecoveryWindow(channel)).since.getTime()).toBeGreaterThan(window.since.getTime());
  expect((await ops.overview(actor, 7, 'UTC')).lifetime.messages).toBe(101);
  expect((await ops.overview(actor, 7, 'UTC')).lifetime.speakers).toBe(1);
});
it('skips ticket channels and their children before requesting messages', async () => {
  await db.query("INSERT INTO ticket(id,request_key,creator_id,category,summary,description,phase,status,private_channel_id) VALUES('00000000-0000-4000-8000-000000000001','history-test',$1,'Other','Private issue','Private description','PRELAUNCH','OPEN',$2)", [user, channel]);
  const list = vi.fn();
  expect((await recoverChannelMessages(ops, channel, null, list)).skipped).toBe(true);
  expect((await recoverChannelMessages(ops, '523456789012345678', channel, list)).skipped).toBe(true);
  expect(list).not.toHaveBeenCalled();
  expect(await db.query('SELECT * FROM community_message_recovery')).toHaveLength(0);
});
it('respects the monitoring start, thirty-day limit and independent channel checkpoints', async () => {
  await ops.messageRecoveryWindow(channel);
  await db.query("UPDATE community_message_recovery SET completed_until=now()-interval '100 days'");
  const window = await ops.messageRecoveryWindow(channel);
  expect(window.until.getTime() - window.since.getTime()).toBeLessThanOrEqual(30 * 86400000 + 1);
  expect(await ops.recoverMessages(channel, null, [message(undefined, 31)], window)).toBe(0);
  const other = await ops.messageRecoveryWindow('other');
  await ops.completeMessageRecovery(channel, window.until);
  expect((await ops.messageRecoveryWindow('other')).since).toEqual(other.since);
  await db.query('TRUNCATE community_message_recovery,gateway_observation');
  expect((await recoverChannelMessages(ops, 'fresh', null, async () => [message()])).recovered).toBe(0);
});

const me = { id: 'bot' } as GuildMember;
function fakeChannel(id: string, type = ChannelType.GuildText, visible = true, history = true) {
  const fetch = vi.fn().mockResolvedValue(new Map());
  return { id, type, guild: { roles: { everyone: { id: 'everyone' } } }, isThread: () => type === ChannelType.PublicThread || type === ChannelType.PrivateThread,
    permissionsFor: (member: unknown) => ({ has: (permissions: unknown) => member === me ? history : permissions === PermissionFlagsBits.ViewChannel && visible }),
    messages: { fetch } };
}
it('checks public visibility and bot history permissions before reading any messages', async () => {
  const publicChannel = fakeChannel(channel);
  const privateChannel = fakeChannel('staff', ChannelType.GuildText, false);
  const noHistory = fakeChannel('no-history', ChannelType.GuildText, true, false);
  const privateThread = fakeChannel('private-thread', ChannelType.PrivateThread);
  const thread = { ...fakeChannel('public-thread', ChannelType.PublicThread), parent: publicChannel, parentId: channel };
  const privateParentThread = { ...thread, parent: privateChannel };
  for (const invalid of [privateChannel, noHistory, privateThread, privateParentThread]) expect(publicHistoryChannel(invalid as unknown as GuildBasedChannel, me)).toBe(false);
  expect(publicHistoryChannel(thread as unknown as GuildBasedChannel, me)).toBe(true);
  const guild = { members: { fetchMe: async () => me }, channels: { fetch: async () => new Map([publicChannel, privateChannel, noHistory, privateThread].map(item => [item.id, item])), fetchActiveThreads: async () => ({ threads: new Map([[thread.id, thread]]) }) } } as unknown as Guild;
  await recoverGuildMessages(guild, ops, vi.fn(), vi.fn());
  expect(publicChannel.messages.fetch).toHaveBeenCalled();
  expect(thread.messages.fetch).toHaveBeenCalled();
  for (const invalid of [privateChannel, noHistory, privateThread]) expect(invalid.messages.fetch).not.toHaveBeenCalled();
});

it('scans public archived threads with pagination and continues after one channel fails', async () => {
  const broken = fakeChannel('broken');
  broken.messages.fetch.mockRejectedValue(new Error('channel unavailable'));
  const healthy = fakeChannel('healthy');
  const forum = { ...fakeChannel('forum', ChannelType.GuildForum), threads: { fetchArchived: vi.fn() } };
  const first = { ...fakeChannel('archive-1', ChannelType.PublicThread), parent: forum, parentId: forum.id, archiveTimestamp: 2000 };
  const second = { ...fakeChannel('archive-2', ChannelType.PublicThread), parent: forum, parentId: forum.id, archiveTimestamp: 1000 };
  forum.threads.fetchArchived.mockResolvedValueOnce({ threads: new Map([[first.id, first]]), hasMore: true }).mockResolvedValueOnce({ threads: new Map([[second.id, second]]), hasMore: false });
  const guild = { roles: { everyone: {} }, members: { fetchMe: async () => me }, channels: {
    fetch: async () => new Map([broken, healthy, forum].map(item => [item.id, item])),
    fetchActiveThreads: async () => ({ threads: new Map() }),
  } } as unknown as Guild;
  const failed = vi.fn();
  await recoverGuildMessages(guild, ops, vi.fn(), failed);
  expect(failed).toHaveBeenCalledWith('broken', expect.any(Error));
  expect(healthy.messages.fetch).toHaveBeenCalled();
  expect(first.messages.fetch).toHaveBeenCalled();
  expect(second.messages.fetch).toHaveBeenCalled();
  expect(forum.threads.fetchArchived.mock.calls[0][0]).toMatchObject({ type: 'public', limit: 100 });
  expect(forum.threads.fetchArchived.mock.calls[1][0].before).toEqual(new Date(2000));
  const checkpoints = await db.query('SELECT channel_id,completed_until FROM community_message_recovery');
  expect(checkpoints).toHaveLength(4);
});

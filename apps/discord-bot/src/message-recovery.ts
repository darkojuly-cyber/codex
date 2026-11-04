import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel, type GuildMember } from 'discord.js';
import type { Operations } from '../../../packages/core/src/operations.js';

export type HistoryMessage = { id: string; user: string; at: Date; bot: boolean; system: boolean; webhook: boolean };
const discordEpoch = 1420070400000n;

export function publicHistoryChannel(channel: GuildBasedChannel, me: GuildMember) {
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.AnnouncementThread].includes(channel.type)) return false;
  const scope = channel.isThread() ? channel.parent : channel;
  return !!scope && 'permissionsFor' in scope
    && !!scope.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
    && !!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
}

export async function recoverChannelMessages(operations: Operations, channel: string, parent: string | null, list: (before: string) => Promise<HistoryMessage[]>) {
  if (!await operations.messageRecoveryAllowed(channel, parent)) return { recovered: 0, skipped: true };
  const window = await operations.messageRecoveryWindow(channel);
  // Include all snowflakes in the scan-start millisecond, excluding future arrivals.
  let before = ((BigInt(window.until.getTime() + 1) - discordEpoch) << 22n).toString();
  let recovered = 0;
  for (;;) {
    const messages = await list(before);
    recovered += await operations.recoverMessages(channel, parent, messages.filter(message => !message.bot && !message.system && !message.webhook), window);
    if (messages.length < 100 || messages.some(message => message.at < window.since)) break;
    const next = messages.reduce((min, message) => BigInt(message.id) < BigInt(min) ? message.id : min, before);
    if (next === before) throw new Error('Message recovery pagination did not advance.');
    before = next;
  }
  await operations.completeMessageRecovery(channel, window.until);
  return { recovered, skipped: false };
}

// Sequential REST requests use discord.js rate-limit handling. A failed channel
// keeps its checkpoint and cannot stop other channels or live message capture.
export async function recoverGuildMessages(guild: Guild, operations: Operations, report: (event: Record<string, unknown>) => void, failed: (channel: string, error: unknown) => void) {
  const me = await guild.members.fetchMe();
  const channels = await guild.channels.fetch();
  const scanned = new Set<string>();
  async function scan(channel: GuildBasedChannel) {
    if (scanned.has(channel.id) || !publicHistoryChannel(channel, me) || !('messages' in channel)) return;
    scanned.add(channel.id);
    try {
      const result = await recoverChannelMessages(operations, channel.id, channel.isThread() ? channel.parentId : null, async before => {
        const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
        return [...messages.values()].map(message => ({ id: message.id, user: message.author.id, at: message.createdAt, bot: message.author.bot, system: message.system, webhook: !!message.webhookId }));
      });
      report({ event: 'operations.messages_recovered', channel: channel.id, ...result });
    } catch (error) { failed(channel.id, error); }
  }
  for (const channel of channels.values()) if (channel) await scan(channel);
  try {
    const active = await guild.channels.fetchActiveThreads(false);
    for (const thread of active.threads.values()) await scan(thread);
  } catch (error) { failed('active_threads', error); }
  for (const channel of channels.values()) {
    if (!channel || !('threads' in channel) || !channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
      || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
      || !await operations.messageRecoveryAllowed(channel.id, null)) continue;
    // Public archived threads can contain newer messages regardless of creation
    // date. Enumerate all archive pages; never request private archived threads.
    try {
      let before: Date | undefined;
      for (;;) {
        const page = await channel.threads.fetchArchived({ type: 'public', limit: 100, before }, false);
        for (const thread of page.threads.values()) await scan(thread);
        if (!page.hasMore) break;
        const timestamps = [...page.threads.values()].map(thread => thread.archiveTimestamp).filter((value): value is number => value !== null);
        if (!timestamps.length) throw new Error('Archived thread pagination unavailable.');
        const next = Math.min(...timestamps);
        if (before && next >= before.getTime()) throw new Error('Archived thread pagination did not advance.');
        before = new Date(next);
      }
    } catch (error) { failed(channel.id, error); }
  }
}

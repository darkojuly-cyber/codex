import { ChannelType, type Message } from 'discord.js';
import type { XpService } from '../../../packages/core/src/xp.js';

export async function scoreGuildMessage(message: Message, xp: Pick<XpService, 'message'>, options: { enabled: boolean; guildId: string; pointsChannelId?: string }) {
  if (!options.enabled || message.guildId !== options.guildId || message.author.bot || message.webhookId || message.system) return;
  if (options.pointsChannelId && (message.channelId === options.pointsChannelId || (message.channel.isThread() && message.channel.parentId === options.pointsChannelId))) return;
  const scope = await messageChannelScope(message);
  return xp.message({ ...scope, user: message.author.id, messageId: message.id, channelId: message.channelId, content: message.content, occurredAt: message.createdAt, bot: false });
}

// A thread's parent is a text/forum channel, not a category. Resolve that extra hop.
// Failed resolution rejects scoring rather than treating an unknown category as public.
export async function messageChannelScope(message: Message): Promise<{ categoryId: string | null; announcement: boolean; parentChannelId: string | null }> {
  if (!message.guild) throw new Error('Guild channel required');
  const channel = message.channel;
  if (channel.isThread()) {
    const parent = channel.parent ?? (channel.parentId ? await message.guild.channels.fetch(channel.parentId) : null);
    if (!parent) throw new Error('Thread parent unavailable');
    return { categoryId: parent.parentId, parentChannelId: channel.parentId, announcement: parent.type === ChannelType.GuildAnnouncement };
  }
  if (!('parentId' in channel)) throw new Error('Channel category unavailable');
  return { categoryId: channel.parentId, parentChannelId: null, announcement: channel.type === ChannelType.GuildAnnouncement };
}

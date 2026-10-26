import { ChannelType, type Message } from 'discord.js';

// A thread's parent is a text/forum channel, not a category. Resolve that extra hop.
// Failed resolution rejects scoring rather than treating an unknown category as public.
export async function messageChannelScope(message: Message): Promise<{ categoryId: string | null; announcement: boolean }> {
  if (!message.guild) throw new Error('Guild channel required');
  const channel = message.channel;
  if (channel.isThread()) {
    const parent = channel.parent ?? (channel.parentId ? await message.guild.channels.fetch(channel.parentId) : null);
    if (!parent) throw new Error('Thread parent unavailable');
    return { categoryId: parent.parentId, announcement: parent.type === ChannelType.GuildAnnouncement };
  }
  if (!('parentId' in channel)) throw new Error('Channel category unavailable');
  return { categoryId: channel.parentId, announcement: channel.type === ChannelType.GuildAnnouncement };
}

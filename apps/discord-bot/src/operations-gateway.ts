import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { messageChannelScope } from './message-scope.js';
import type { Operations } from '../../../packages/core/src/operations.js';
export async function observePublicMessage(message: Message, operations: Operations, guildId: string, contentEnabled: boolean) {
  if (message.guildId !== guildId || !message.guild || message.author.bot || message.webhookId || message.system) return;
  if (message.channel.type === ChannelType.PrivateThread) return;
  const channel = message.channel.isThread() ? message.channel.parent ?? (message.channel.parentId ? await message.guild.channels.fetch(message.channel.parentId) : null) : message.channel;
  if (!channel || !('permissionsFor' in channel) || !channel.permissionsFor(message.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return;
  const scope = await messageChannelScope(message);
  await operations.observeProfile(message.author.id, message.member?.displayName || message.author.globalName || message.author.username, message.author.username);
  await operations.message({ id: message.id, user: message.author.id, channel: message.channelId, category: scope.categoryId, parent: scope.parentChannelId, at: message.createdAt, content: contentEnabled ? message.content : undefined, mentionCount: message.mentions?.users.size ?? 0, mentionEveryone: message.mentions?.everyone ?? false });
}

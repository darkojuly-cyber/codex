import { expect, it, vi } from 'vitest';
import { ChannelType, type Message } from 'discord.js';
import { messageChannelScope } from '../apps/discord-bot/src/message-scope.js';

it('resolves text channels and uncategorized channels', async () => {
  for (const category of ['1560526680613716068', null]) {
    const message = { guild: {}, channel: { isThread: () => false, parentId: category, type: ChannelType.GuildText } } as unknown as Message;
    expect(await messageChannelScope(message)).toEqual({ categoryId: category, announcement: false });
  }
});

it('inherits forum and announcement thread categories, fetching an uncached parent', async () => {
  for (const type of [ChannelType.GuildForum, ChannelType.GuildAnnouncement]) {
    const fetch = vi.fn(async () => ({ parentId: '1560526751317106819', type }));
    const message = { guild: { channels: { fetch } }, channel: { isThread: () => true, parent: null, parentId: '123456789012345678' } } as unknown as Message;
    expect(await messageChannelScope(message)).toEqual({ categoryId: '1560526751317106819', announcement: type === ChannelType.GuildAnnouncement });
    expect(fetch).toHaveBeenCalledWith('123456789012345678');
  }
});

it('does not treat a missing thread parent as an uncategorized channel', async () => {
  const message = { guild: { channels: { fetch: async () => null } }, channel: { isThread: () => true, parent: null, parentId: '123456789012345678' } } as unknown as Message;
  await expect(messageChannelScope(message)).rejects.toThrow('Thread parent unavailable');
});

import { expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { welcomeCard } from '../packages/core/src/welcome-card.js';
import { DiscordTransport } from '../packages/core/src/transport.js';
import type { Env } from '../packages/core/src/env.js';

it('builds a valid welcome embed with member artwork and the existing button routes', () => {
  const avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
  const payload = welcomeCard('Welcome Alice! @everyone', { avatarUrl });
  const embed = EmbedBuilder.from(payload.embeds[0]).toJSON();
  expect(embed.color).toBe(0xa78bfa);
  expect(embed.description).toBe('Welcome Alice! @everyone');
  expect(embed.thumbnail?.url).toBe(avatarUrl);
  expect(payload.components[0].components.map(button => 'custom_id' in button ? button.custom_id : '')).toEqual(['idea:another', 'links:current', 'ticket:new']);
  expect(embed.fields).toHaveLength(3);
});

it('omits unavailable artwork and rejects images outside Discord CDN', () => {
  const embed = welcomeCard('Hello', { avatarUrl: 'https://tracker.example/avatar', guildIconUrl: 'javascript:bad' }).embeds[0];
  expect(embed.thumbnail).toBeUndefined();
  expect(embed.author?.icon_url).toBeUndefined();
});

it('sends automatic welcome as an embed and mentions only the joining member; normal messages stay plain', async () => {
  const transport = new DiscordTransport({ DISCORD_TOKEN: 'test-token', DISCORD_GUILD_ID: 'guild', DISCORD_WRITES_ENABLED: 'true' } as Env);
  vi.spyOn(transport, 'channelBelongsToGuild').mockResolvedValue(true);
  const post = vi.spyOn(transport.rest, 'post').mockResolvedValue({ id: 'message' });
  await transport.send('channel', 'Hello @everyone', 'delivery', { welcomeCard: true, mentionUser: '123456789012345678' });
  expect(post).toHaveBeenLastCalledWith(expect.any(String), { body: expect.objectContaining({
    content: '<@123456789012345678>', embeds: [expect.objectContaining({ description: 'Hello @everyone' })],
    allowed_mentions: { parse: [], users: ['123456789012345678'], roles: [], replied_user: false },
  }) });
  await transport.send('channel', 'Ordinary announcement', 'other-delivery');
  const body = post.mock.calls[1][1]?.body as Record<string, unknown>;
  expect(body.content).toBe('Ordinary announcement');
  expect(body.embeds).toBeUndefined();
});

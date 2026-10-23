import { expect, it, vi } from 'vitest';
import { MessageFlags, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { showPoints } from '../apps/discord-bot/src/points.js';
import { xpDefaults } from '../packages/core/src/xp-config.js';
import type { XpService } from '../packages/core/src/xp.js';

function interaction(command: string, subcommand = 'rules', page = 1) {
  const deferReply = vi.fn(async () => {});
  const editReply = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
  return { value: { isButton: () => false, commandName: command, user: { id: '123456789012345678' }, options: { getSubcommand: () => subcommand, getInteger: () => page, getString: () => 'all_time' }, deferReply, editReply } as unknown as ChatInputCommandInteraction, deferReply, editReply };
}

it('acknowledges immediately and paginates published rules within Discord embed limits', async () => {
  const command = interaction('points');
  const config = structuredClone(xpDefaults);
  for (const rule of config.rules) { rule.label = 'A'.repeat(80); rule.channels = Array.from({ length: 50 }, (_, i) => String(223456789012345600n + BigInt(i))); }
  const current = vi.fn(async () => { expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral }); return { version: 3, body: config, published_at: new Date() }; });
  await showPoints(command.value, { current } as unknown as XpService);
  const payload = command.editReply.mock.calls[0][0] as { embeds: Record<string, unknown>[]; allowedMentions: unknown };
  expect(payload.embeds).toHaveLength(1);
  expect(String(payload.embeds[0].description)).toContain('Scoring disabled');
  expect(String(payload.embeds[0].description).length).toBeLessThanOrEqual(4096);
  expect(() => EmbedBuilder.from(payload.embeds[0]).toJSON()).not.toThrow();
  expect(payload.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
});

it('looks up history for the requesting user only and escapes user-authored reasons', async () => {
  const command = interaction('points', 'history');
  const history = vi.fn(async () => [{ amount: 10, reason: '@everyone **surprise**', occurred_at: new Date(), rule_version: 2 }]);
  await showPoints(command.value, { history } as unknown as XpService);
  expect(history).toHaveBeenCalledWith('123456789012345678', 1);
  const text = JSON.stringify(command.editReply.mock.calls[0][0]);
  expect(text).not.toContain('@everyone');
  expect(text).not.toContain('**surprise**');
});

it('shows empty leaderboards without mentioning users', async () => {
  const command = interaction('leaderboard');
  const leaderboard = vi.fn(async () => ({ entries: [], timezone: 'Asia/Shanghai' }));
  await showPoints(command.value, { leaderboard } as unknown as XpService);
  expect(leaderboard).toHaveBeenCalledWith('all_time', 1);
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain('No entries');
});

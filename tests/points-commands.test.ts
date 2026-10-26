import { expect, it, vi } from 'vitest';
import { MessageFlags, EmbedBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { showPoints } from '../apps/discord-bot/src/points.js';
import { evoPointsIntro, evoPointsTitle, evoPointsFooter, pointsGuide, pointsButtonIds } from '../apps/discord-bot/src/points-card.js';
import { xpDefaults } from '../packages/core/src/xp-config.js';
import type { XpService } from '../packages/core/src/xp.js';

const avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
function interaction(command: string, subcommand = 'rules', page = 1) {
  const deferReply = vi.fn(async () => {});
  const editReply = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
  return { value: { isButton: () => false, isChatInputCommand: () => true, commandName: command, user: { id: '123456789012345678', displayAvatarURL: () => avatar }, options: { getSubcommand: () => subcommand, getInteger: () => page, getString: () => 'all_time' }, deferReply, editReply } as unknown as ChatInputCommandInteraction, deferReply, editReply };
}
function button(customId: string) {
  const slash = interaction('');
  return { ...slash, value: { ...slash.value, isButton: () => true, isChatInputCommand: () => false, customId, options: undefined } as unknown as ButtonInteraction };
}

it('acknowledges before querying and displays the agreed member card with artwork and working navigation IDs', async () => {
  const command = interaction('points');
  const current = vi.fn(async () => { expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral }); return { version: 3, body: xpDefaults, published_at: new Date() }; });
  await showPoints(command.value, { current } as unknown as XpService);
  const payload = command.editReply.mock.calls[0][0] as ReturnType<typeof pointsGuide> & { allowedMentions: unknown };
  expect(payload.embeds).toHaveLength(1);
  const embed = payload.embeds[0];
  expect(embed.title).toBe(evoPointsTitle);
  expect(embed.description).toContain(evoPointsIntro);
  expect(embed.footer?.text).toBe(evoPointsFooter);
  expect(embed.thumbnail?.url).toBe(avatar);
  expect(embed.author?.name).toContain('aren’t being awarded yet');
  expect(embed.description).toContain('First meaningful message: **10 points**, once per member.');
  expect(embed.description).toContain('Reviewed creations or creative tips: **5 points** · up to 20/day.');
  expect(embed.description).toContain('bug reports or suggestions: **3 points** · up to 18/day.');
  expect(embed.description).toContain('**20 points** for your first qualifying Boost, plus **30 points**');
  expect(embed.description).not.toMatch(/Official discussions|activities|Daily cap|Cooldown|Scoring disabled|rule v/);
  const buttons = payload.components[0].components;
  expect(buttons.map(b => 'label' in b ? b.label : '')).toEqual(['My Points', 'Weekly Board', 'Monthly Board']);
  expect(buttons.map(b => 'custom_id' in b ? b.custom_id : '')).toEqual(['xp:rank', 'xp:leaderboard:weekly', 'xp:leaderboard:monthly']);
  expect(buttons.every(b => 'custom_id' in b && pointsButtonIds.some(id => id === b.custom_id))).toBe(true);
  expect(() => EmbedBuilder.from(embed).toJSON()).not.toThrow();
  expect(payload.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
});

it('uses published reward values, hides unavailable rules and never turns a paused setup into an earning promise', () => {
  const config = structuredClone(xpDefaults);
  config.enabled = true;
  config.rules.find(r => r.event === 'chat')!.channels = ['123456789012345678'];
  config.rules.find(r => r.event === 'chat')!.points = 4;
  config.rules.find(r => r.event === 'creation')!.enabled = false;
  config.rules.find(r => r.event === 'confirmed_issue')!.endsAt = '2020-01-01T00:00:00Z';
  config.rules.find(r => r.event === 'boost_30d')!.enabled = false;
  const embed = pointsGuide(config).embeds[0];
  expect(embed.description).toContain('Eligible chat: **4 points**');
  expect(embed.description).not.toContain('Reviewed creations');
  expect(embed.description).not.toContain('bug reports');
  expect(embed.description).not.toContain('First meaningful message'); // no eligible channels
  expect(embed.description).not.toContain('30 days'); // recurring Boost disabled
  expect(embed.description).toContain('**20 points** for your first qualifying Boost');
  expect(embed.author?.name).toBe('EVOMEME COMMUNITY');
  expect(embed.thumbnail).toBeUndefined();
});

it('keeps the card compact even with maximal admin labels and channel lists, omitting technical metadata', () => {
  const config = structuredClone(xpDefaults);
  for (const rule of config.rules) { rule.label = 'A'.repeat(80); rule.channels = Array.from({ length: 50 }, (_, i) => String(223456789012345600n + BigInt(i))); }
  const embed = pointsGuide(config, { avatarUrl: 'https://tracker.example/private' }).embeds[0];
  expect(embed.description!.length).toBeLessThan(3000);
  expect(embed.description).not.toContain('A'.repeat(80));
  expect(embed.description).not.toContain('<#');
  expect(embed.thumbnail).toBeUndefined();
  expect(() => EmbedBuilder.from(embed).toJSON()).not.toThrow();
});

it.each(['weekly','monthly'] as const)('routes the %s board button to current data rather than to the rules card', async period => {
  const command = button(`xp:leaderboard:${period}`);
  const leaderboard = vi.fn(async () => ({ entries: [{ user_id: '123456789012345678', rank: 1, xp: 42 }], timezone: 'Asia/Shanghai' }));
  await showPoints(command.value, { leaderboard } as unknown as XpService);
  expect(leaderboard).toHaveBeenCalledWith(period, 1);
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain('42 points');
  expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
});

it('routes My Points to the pressing member’s own account', async () => {
  const command = button('xp:rank');
  const summary = vi.fn(async () => ({ lifetimeXp: 30, level: 1, nextLevelXp: 100, ranks: { weekly: 2, monthly: 3, all_time: 4 }, enabled: true }));
  await showPoints(command.value, { summary } as unknown as XpService);
  expect(summary).toHaveBeenCalledWith('123456789012345678');
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain('30 points');
});

it('keeps old welcome xp:rules buttons working', async () => {
  const command = button('xp:rules');
  await showPoints(command.value, { current: async () => ({ body: xpDefaults }) } as unknown as XpService);
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain(evoPointsTitle);
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

it('shows a friendly empty board without inventing members or points', async () => {
  const command = interaction('leaderboard');
  const leaderboard = vi.fn(async () => ({ entries: [], timezone: 'Asia/Shanghai' }));
  await showPoints(command.value, { leaderboard } as unknown as XpService);
  expect(leaderboard).toHaveBeenCalledWith('all_time', 1);
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain('No points on this board yet');
});

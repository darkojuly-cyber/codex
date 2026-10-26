import { expect, it, vi } from 'vitest';
import { MessageFlags, EmbedBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { showPoints } from '../apps/discord-bot/src/points.js';
import { evoPointsIntro, evoPointsTitle, evoPointsFooter, pointsGuide, pointsButtonIds, pointsPaused } from '../apps/discord-bot/src/points-card.js';
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
  expect(embed.author?.name).toBe('EVOMEME COMMUNITY');
  expect(embed.description).toContain(pointsPaused);
  expect(embed.description).toContain('Reviewed contributions earn points after team approval.');
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
  const summary = vi.fn(async () => ({ timezone: 'Asia/Shanghai', periodXp: { weekly: 12, monthly: 20, all_time: 30 }, lifetimeXp: 30, level: 1, nextLevelXp: 100, ranks: { weekly: 2, monthly: 3, all_time: 4 }, enabled: true }));
  await showPoints(command.value, { summary } as unknown as XpService);
  expect(summary).toHaveBeenCalledWith('123456789012345678');
  expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain('30 Evo Points');
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

it('shows first-message and chat rewards in category mode without channel bindings', () => {
  const config = { ...structuredClone(xpDefaults), enabled: true, excludedCategoryIds: ['1560526680613716068'] };
  const description = pointsGuide(config).embeds[0].description;
  expect(description).toContain('First meaningful message: **10 points**');
  expect(description).toContain('Eligible chat: **2 points**');
});

let publicChannelNumber = 0;
function inPointsChannel(command: ReturnType<typeof interaction> | ReturnType<typeof button>, channelId = String(823456789012345600n + BigInt(++publicChannelNumber))) {
  Object.assign(command.value, { guildId: '923456789012345678', channelId });
  return { ...command, channelId };
}
const account = { timezone: 'Asia/Shanghai', periodXp: { weekly: 12, monthly: 20, all_time: 30 }, lifetimeXp: 30, ranks: { weekly: 2, monthly: 3, all_time: 4 }, enabled: true };

it.each(['rules', 'rank', 'leaderboard'])('shares %s publicly only in the configured channel', async kind => {
  const command = inPointsChannel(interaction(kind === 'rules' ? 'points' : kind));
  const xp = { current: async () => ({ body: xpDefaults }), summary: async () => account,
    leaderboard: async () => ({ entries: [], timezone: 'Asia/Shanghai', enabled: true }) } as unknown as XpService;
  await showPoints(command.value, xp, { channelId: command.channelId });
  expect(command.deferReply).toHaveBeenCalledWith({});
  const payload = JSON.stringify(command.editReply.mock.calls[0][0]);
  if (kind === 'rank') {
    expect(payload).toContain('123456789012345678 · Evo Points');
    expect(payload).toContain('#4 · Overall Rank');
    expect(payload).not.toMatch(/Level|next level/);
  }
});

it.each(['xp:rank', 'xp:leaderboard:weekly', 'xp:leaderboard:monthly', 'xp:rules'])('keeps shared card button %s private to the person clicking', async id => {
  const command = inPointsChannel(button(id));
  const summary = vi.fn(async () => account);
  await showPoints(command.value, { summary, current: async () => ({ body: xpDefaults }), leaderboard: async () => ({ entries: [], timezone: 'Asia/Shanghai', enabled: true }) } as unknown as XpService, { channelId: command.channelId });
  expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  if (id === 'xp:rank') expect(summary).toHaveBeenCalledWith('123456789012345678');
});

it('keeps history, other channels and an unset points channel private', async () => {
  for (const kind of ['history', 'other-channel', 'unset']) {
    const command = inPointsChannel(interaction(kind === 'history' ? 'points' : 'rank', 'history'));
    await showPoints(command.value, { history: async () => [], summary: async () => account } as unknown as XpService,
      { channelId: kind === 'unset' ? undefined : kind === 'other-channel' ? '723456789012345678' : command.channelId });
    expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  }
});

it('limits concurrent public cards across members and commands; buttons bypass the cooldown and it expires', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1793000000000);
  try {
    const first = inPointsChannel(interaction('rank'));
    const second = inPointsChannel(interaction('leaderboard'), first.channelId);
    Object.assign(second.value, { user: { id: '223456789012345678' } });
    const summary = vi.fn(async () => account);
    const leaderboard = vi.fn(async () => ({ entries: [], timezone: 'Asia/Shanghai', enabled: true }));
    const xp = { summary, leaderboard } as unknown as XpService;
    await Promise.all([showPoints(first.value, xp, { channelId: first.channelId }), showPoints(second.value, xp, { channelId: first.channelId })]);
    expect(first.deferReply).toHaveBeenCalledWith({});
    expect(second.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(JSON.stringify(second.editReply.mock.calls[0][0])).toContain('private result');
    expect(leaderboard).toHaveBeenCalledTimes(1);
    const privateButton = inPointsChannel(button('xp:rank'), first.channelId);
    await showPoints(privateButton.value, xp, { channelId: first.channelId });
    expect(summary).toHaveBeenCalledTimes(2);
    for (const id of ['xp:rank', 'xp:leaderboard:weekly', 'xp:leaderboard:monthly', 'xp:rules']) {
      const click = inPointsChannel(button(id), first.channelId);
      await showPoints(click.value, { ...xp, current: async () => ({ body: xpDefaults }) } as unknown as XpService, { channelId: first.channelId });
      expect(click.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect((click.editReply.mock.calls[0][0] as { content?: string }).content).toBeUndefined();
    }
    expect(leaderboard).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(1793000060000);
    const later = inPointsChannel(interaction('leaderboard'), first.channelId);
    await showPoints(later.value, xp, { channelId: first.channelId });
    expect(later.deferReply).toHaveBeenCalledWith({});
    expect(leaderboard).toHaveBeenCalledTimes(4);
  } finally { clock.mockRestore(); }
});

it('uses one paused message across the rule card, personal points and empty boards', async () => {
  const xp = { summary: async () => ({ ...account, enabled: false }), leaderboard: async () => ({ entries: [], timezone: 'Asia/Shanghai', enabled: false }) } as unknown as XpService;
  const rank = button('xp:rank');
  const board = button('xp:leaderboard:monthly');
  await showPoints(rank.value, xp);
  await showPoints(board.value, xp);
  expect(pointsGuide(xpDefaults).embeds[0].description).toContain(pointsPaused);
  for (const command of [rank, board]) expect(JSON.stringify(command.editReply.mock.calls[0][0])).toContain(pointsPaused);
  expect(JSON.stringify(board.editReply.mock.calls[0][0])).not.toContain('as members begin earning');
  expect(JSON.stringify(rank.editReply.mock.calls[0][0])).not.toMatch(/Level|next level/);
});

it('puts the overall rank in the main title, with clear unranked and weekly/monthly states', async () => {
  for (const ranked of [true, false]) {
    const command = interaction('rank');
    await showPoints(command.value, { summary: async () => ({ ...account, ranks: ranked ? account.ranks : { weekly: null, monthly: null, all_time: null }, lifetimeXp: ranked ? 30 : 0 }) } as unknown as XpService);
    const embed = (command.editReply.mock.calls[0][0] as { embeds: { title: string; fields: { name: string; value: string }[] }[] }).embeds[0];
    expect(embed.title).toBe(ranked ? '🏆 #4 · Overall Rank' : '✨ Unranked · Overall Rank');
    expect(embed.fields.map(field => field.value)).toEqual(ranked ? ['🥈 **#2**', '🥉 **#3**', '🏆 **#4**'] : ['Unranked', 'Unranked', 'Unranked']);
    expect(() => EmbedBuilder.from(embed).toJSON()).not.toThrow();
  }
});

it('explains commands and calendar ranking periods using the configured timezone', () => {
  const embed = pointsGuide({ ...xpDefaults, timezone: 'America/New_York' }).embeds[0];
  expect(embed.description).toContain('`/rank` — your points and rankings.');
  expect(embed.description).toContain('`/leaderboard` — community rankings.');
  expect(embed.description).toContain('Monday 00:00');
  expect(embed.description).toContain('the 1st, 00:00');
  expect(embed.description).toContain('**America/New_York**');
  expect(embed.description).toContain('Equal points share a rank');
  expect(embed.description).toContain('your total points stay');
});

it('shows a points overview for My Points and preserves the podium rank card when /rank falls back to private delivery', async () => {
  const command = inPointsChannel(interaction('rank'));
  const mine = inPointsChannel(button('xp:rank'), command.channelId);
  const cooled = inPointsChannel(interaction('rank'), command.channelId);
  const summary = vi.fn(async () => ({ ...account, ranks: { weekly: 1, monthly: 1, all_time: 1 } }));
  const xp = { summary } as unknown as XpService;
  for (const value of [command, mine, cooled]) await showPoints(value.value, xp, { channelId: command.channelId });
  const payload = (value: typeof command | typeof mine) => value.editReply.mock.calls[0][0] as { content?: string; embeds: { title: string; color: number; fields: { value: string }[] }[] };
  expect(payload(command).embeds[0].title).toBe('🥇 #1 · Overall Rank');
  expect(payload(command).embeds[0].color).toBe(0xf6c453);
  expect(payload(mine).embeds[0].title).toBe('✨ 30 Evo Points');
  expect(payload(mine).embeds[0].color).toBe(0xa78bfa);
  expect(payload(mine).embeds[0].fields.map(field => field.value)).toEqual(['**12 points**', '**20 points**', '🥇 **#1**']);
  expect(payload(mine).content).toBeUndefined();
  expect(payload(cooled).content).toContain('private result');
  expect(payload(cooled).embeds[0]).toEqual(payload(command).embeds[0]);
  expect(mine.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(cooled.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(summary).toHaveBeenCalledTimes(3);
});

it('keeps admin points visible, explains their ranking exclusion and still reports a paused scoring state', async () => {
  for (const enabled of [true, false]) {
    const xp = { summary: async () => ({ ...account, enabled, eligible: true, rankEligible: false, ranks: { weekly: null, monthly: null, all_time: null } }) } as unknown as XpService;
    for (const command of [button('xp:rank'), interaction('rank')]) {
      await showPoints(command.value, xp);
      const payload = JSON.stringify(command.editReply.mock.calls[0][0]);
      expect(payload).toContain('30');
      expect(payload).toContain(enabled ? 'Your points are recorded. Admin accounts are not included in leaderboards.' : pointsPaused);
      expect(payload).not.toContain('Earn your first points');
    }
  }
});

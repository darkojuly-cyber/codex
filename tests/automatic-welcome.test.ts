import { expect, it, vi } from 'vitest';
import { GuildMemberFlags, type GuildMember } from 'discord.js';
import { automaticWelcome } from '../apps/discord-bot/src/automatic-welcome.js';

const startedAt = new Date('2026-10-23T00:00:00Z');
function member(options: { completed?: boolean; pending?: boolean; onboarding?: boolean; joinedAt?: Date; bot?: boolean; guildId?: string } = {}) {
  return {
    id: 'alice', joinedAt: options.joinedAt ?? new Date(startedAt.getTime() + 1000), pending: options.pending ?? false,
    user: { bot: options.bot ?? false },
    flags: { has: (flag: GuildMemberFlags) => flag === GuildMemberFlags.CompletedOnboarding && !!options.completed },
    guild: { id: options.guildId ?? 'test', fetchOnboarding: vi.fn(async () => ({ enabled: options.onboarding ?? true })) },
  } as unknown as GuildMember;
}
function setup() {
  const welcome = vi.fn(async () => true);
  return { welcome, handler: automaticWelcome({ guildId: 'test', startedAt, welcome }) };
}

it('posts on join when onboarding is disabled, but waits when it is enabled', async () => {
  const { welcome, handler } = setup();
  await handler.joined(member({ onboarding: true }));
  expect(welcome).not.toHaveBeenCalled();
  await handler.joined(member({ onboarding: false }));
  expect(welcome).toHaveBeenCalledWith('alice', expect.any(Date), true, startedAt);
});

it('posts on onboarding completion even when the member joined before the bot restarted', async () => {
  const { welcome, handler } = setup();
  const joinedAt = new Date(startedAt.getTime() - 10000);
  await handler.updated(member({ joinedAt }), member({ joinedAt, completed: true }));
  expect(welcome).toHaveBeenCalledWith('alice', joinedAt, true, new Date(0));
  welcome.mockClear();
  await handler.updated(member({ completed: true }), member({ completed: true }));
  expect(welcome).not.toHaveBeenCalled();
});

it('waits for membership screening and then applies the onboarding requirement', async () => {
  const { welcome, handler } = setup();
  await handler.joined(member({ pending: true, onboarding: false }));
  await handler.updated(member({ pending: true }), member({ pending: false, onboarding: true }));
  expect(welcome).not.toHaveBeenCalled();
  await handler.updated(member({ pending: true }), member({ pending: false, onboarding: false }));
  expect(welcome).toHaveBeenCalledTimes(1);
});

it('ignores bots, other guilds, old join events and unrelated member updates', async () => {
  const { welcome, handler } = setup();
  await handler.joined(member({ bot: true, completed: true }));
  await handler.joined(member({ guildId: 'other', completed: true }));
  await handler.joined(member({ joinedAt: new Date(0), completed: true }));
  await handler.updated(member(), member());
  expect(welcome).not.toHaveBeenCalled();
});

it('does not send early if Discord onboarding lookup fails', async () => {
  const { welcome, handler } = setup();
  const incoming = member();
  vi.mocked(incoming.guild.fetchOnboarding).mockRejectedValue(new Error('unavailable'));
  await expect(handler.joined(incoming)).rejects.toThrow('unavailable');
  expect(welcome).not.toHaveBeenCalled();
});

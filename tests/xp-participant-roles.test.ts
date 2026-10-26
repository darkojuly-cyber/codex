import { expect, it, vi } from 'vitest';
import { PermissionFlagsBits, Routes } from 'discord.js';
import { DiscordTransport } from '../packages/core/src/transport.js';
import { readEnv } from '../packages/core/src/env.js';

const guild = '123456789012345678';
const member = '223456789012345678';
const role = '323456789012345678';
function transport(options: { permissions?: bigint; staff?: boolean; mod?: boolean; owner?: boolean; bot?: boolean; superadmin?: boolean } = {}) {
  const adapter = new DiscordTransport({ ...readEnv(), DISCORD_GUILD_ID: guild, DISCORD_TOKEN: 'test-token', STAFF_ROLE_IDS: options.staff ? role : '', MODERATOR_ROLE_IDS: options.mod ? role : '', SUPPORT_ROLE_IDS: '', SUPER_ADMIN_USER_IDS: options.superadmin ? member : '' });
  vi.spyOn(adapter.rest, 'get').mockImplementation(async path => {
    if (path === Routes.guildMember(guild, member)) return { roles: [role], user: { bot: options.bot ?? false } };
    if (path === Routes.guildRoles(guild)) return [{ id: guild, permissions: '0' }, { id: role, permissions: String(options.permissions ?? 0n) }];
    if (path === Routes.guild(guild)) return { owner_id: options.owner ? member : '423456789012345678' };
    throw new Error('Unexpected route');
  });
  return adapter;
}
it('keeps staff and moderators earning and ranking while only owners are excluded from ranking', async () => {
  for (const options of [{}, { staff: true }, { mod: true }]) expect(await transport(options).xpParticipant(member)).toEqual({ canEarn: true, canRank: true });
  expect(await transport({ owner: true }).xpParticipant(member)).toEqual({ canEarn: true, canRank: false });
  expect(await transport({ superadmin: true }).xpParticipant(member)).toEqual({ canEarn: true, canRank: false });
  expect(await transport({ bot: true }).xpParticipant(member)).toEqual({ canEarn: false, canRank: false });
});
it.each([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers])('only Administrator permission affects ranking; moderation permission %s never stops earning', async permission => {
  expect(await transport({ permissions: permission }).xpParticipant(member)).toEqual({ canEarn: true, canRank: permission !== PermissionFlagsBits.Administrator });
});
it('propagates failed role verification rather than assuming the account is ordinary', async () => {
  const adapter = transport();
  vi.mocked(adapter.rest.get).mockRejectedValue(new Error('Unavailable'));
  await expect(adapter.xpParticipant(member)).rejects.toThrow('Unavailable');
});

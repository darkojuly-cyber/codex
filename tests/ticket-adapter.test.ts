import { expect, it, vi } from 'vitest';
import { PermissionFlagsBits, Routes } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { DiscordTransport } from '../packages/core/src/transport.js';
import { readEnv } from '../packages/core/src/env.js';

const guild = '123456789012345678', staff = '223456789012345678', mod = '323456789012345678', supportRole = '423456789012345678', owner = '523456789012345678', bot = '623456789012345678', category = '723456789012345678', channel = '823456789012345678', supportUser = '923456789012345678';
function adapter() { return new DiscordTransport({ ...readEnv(), DISCORD_TOKEN: 'test-token', DISCORD_WRITES_ENABLED: 'true', DISCORD_GUILD_ID: guild, STAFF_ROLE_IDS: staff, MODERATOR_ROLE_IDS: mod, SUPPORT_ROLE_IDS: supportRole, SUPER_ADMIN_USER_IDS: '' }); }
it('grants staff/mod access but never grants every Support account access to a new private ticket', async () => {
  const transport = adapter();
  vi.spyOn(transport.rest, 'get').mockImplementation(async route => route === Routes.user() ? { id: bot } : { type: 4, guild_id: guild });
  const post = vi.spyOn(transport.rest, 'post').mockResolvedValue({ id: channel });
  await transport.createTicket(owner, category, 1);
  const payload = post.mock.calls[0][1] as { body: { permission_overwrites: { id: string; type: number; allow: string; deny: string }[] } };
  expect(payload.body.permission_overwrites.find(row => row.id === guild)?.deny).toBe(String(PermissionFlagsBits.ViewChannel));
  expect(payload.body.permission_overwrites.some(row => row.id === supportRole)).toBe(false);
  for (const id of [staff, mod, owner, bot]) expect(payload.body.permission_overwrites.some(row => row.id === id)).toBe(true);
});
it('synchronizes individual assignment and read-only closure without exposing internal notes', async () => {
  const transport = adapter();
  vi.spyOn(transport.rest, 'get').mockImplementation(async route => route === Routes.user() ? { id: bot } : { type: 0, guild_id: guild });
  const patch = vi.spyOn(transport.rest, 'patch').mockResolvedValue({ id: '723456789012345679' });
  const ticket = { id: randomUUID(), seq: 1, creator_id: owner, assigned_to: supportUser, status: 'CLOSED', category: 'Bug', summary: 'A game issue', description: 'User-visible details', note: 'INTERNAL SECRET' };
  await transport.syncTicket(channel, '723456789012345679', ticket);
  const permissions = (patch.mock.calls[0][1] as { body: { permission_overwrites: { id: string; allow: string; deny: string }[] } }).body.permission_overwrites;
  expect(permissions.some(row => row.id === supportRole)).toBe(false);
  expect(permissions.some(row => row.id === supportUser)).toBe(true);
  expect(BigInt(permissions.find(row => row.id === owner)!.deny) & PermissionFlagsBits.SendMessages).not.toBe(0n);
  expect(JSON.stringify(patch.mock.calls[1][1])).not.toContain('INTERNAL SECRET');
  await transport.syncTicket(channel, '723456789012345679', { ...ticket, status: 'OPEN', assigned_to: null });
  const reopened = (patch.mock.calls[2][1] as { body: { permission_overwrites: { id: string; allow: string }[] } }).body.permission_overwrites;
  expect(reopened.some(row => row.id === supportUser)).toBe(false);
  expect(BigInt(reopened.find(row => row.id === owner)!.allow) & PermissionFlagsBits.SendMessages).not.toBe(0n);
});
it('refuses to overwrite someone else’s message when updating the persistent support panel', async () => {
  const transport = adapter();
  vi.spyOn(transport.rest, 'get').mockImplementation(async route => {
    if (route === Routes.user()) return { id: bot };
    if (route === Routes.channel(channel)) return { type: 0, guild_id: guild };
    return { author: { id: owner }, components: [{ components: [{ custom_id: 'ticket:new' }] }] };
  });
  const patch = vi.spyOn(transport.rest, 'patch');
  await expect(transport.publishTicketPanel(channel, '723456789012345679')).rejects.toMatchObject({ code: 'TICKET_PANEL_NOT_OWNED' });
  expect(patch).not.toHaveBeenCalled();
});

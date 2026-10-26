import { expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import { handleTicketInteraction } from '../apps/discord-bot/src/tickets.js';
import { defaults, AppError } from '../packages/core/src/config.js';
import { readEnv } from '../packages/core/src/env.js';
import type { CommunityService } from '../packages/core/src/service.js';

const guild = '123456789012345678', user = '223456789012345678', channel = '323456789012345678';
const env = { ...readEnv(), DISCORD_GUILD_ID: guild };
function interaction(extra: Record<string, unknown>) {
  return { guildId: guild, channelId: channel, user: { id: user }, id: '623456789012345678', isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false, deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}), ...extra };
}
it('acknowledges privately before reading configuration and offers six fixed topics', async () => {
  const command = interaction({ isChatInputCommand: () => true, commandName: 'ticket' });
  const current = vi.fn(async () => { expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral }); return { body: { ...defaults, enabled: { ...defaults.enabled, tickets: true }, channels: { ...defaults.channels, ticketCategory: channel } } }; });
  await handleTicketInteraction(command as unknown as Interaction, { current } as unknown as CommunityService, env);
  const payload = command.editReply.mock.calls[0] as unknown as [{ components: { toJSON(): { components: { options: unknown[] }[] } }[] }];
  expect(payload[0].components[0].toJSON().components[0].options).toHaveLength(6);
});
it('opens the native modal without a remote database query when a topic is selected', async () => {
  const showModal = vi.fn(async () => {});
  const value = interaction({ isStringSelectMenu: () => true, customId: 'ticket:type', values: ['bug'], showModal });
  const current = vi.fn();
  await handleTicketInteraction(value as unknown as Interaction, { current } as unknown as CommunityService, env);
  expect(current).not.toHaveBeenCalled(); expect(showModal).toHaveBeenCalledOnce();
});
it('defers before provisioning and returns a private channel link after successful submission', async () => {
  const fields: Record<string, string> = { summary: 'A game issue', description: 'The game does not start after pressing play.', environment: 'Windows Chrome' };
  const value = interaction({ isModalSubmit: () => true, customId: 'ticket:create:bug', fields: { getTextInputValue: (key: string) => fields[key] } });
  const createTicket = vi.fn(async () => { expect(value.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral }); return { seq: 1, status: 'OPEN', private_channel_id: channel }; });
  await handleTicketInteraction(value as unknown as Interaction, { createTicket } as unknown as CommunityService, env);
  expect(createTicket).toHaveBeenCalledWith(user, value.id, { category: 'Bug', ...fields });
  expect(value.editReply).toHaveBeenCalledOnce();
});
it('never closes a guessed ticket for an unrelated non-staff member', async () => {
  const value = interaction({ isButton: () => true, customId: 'ticket:close:12345678-1234-1234-1234-123456789abc' });
  const memberTicketAction = vi.fn();
  const service = { db: { query: async () => [{ creator_id: '423456789012345678', private_channel_id: channel }] }, transport: { ticketStaff: async () => { throw new AppError(403, 'STAFF_ROLE_REQUIRED'); } }, memberTicketAction } as unknown as CommunityService;
  await expect(handleTicketInteraction(value as unknown as Interaction, service, env)).rejects.toMatchObject({ code: 'STAFF_ROLE_REQUIRED' });
  expect(memberTicketAction).not.toHaveBeenCalled();
});

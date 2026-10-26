import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type Interaction, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import { AppError, type Actor } from '../../../packages/core/src/config.js';
import type { CommunityService } from '../../../packages/core/src/service.js';
import type { Env } from '../../../packages/core/src/env.js';
import { ticketCategories, ticketCategoryKeys } from '../../../packages/core/src/ticket-card.js';

const noMentions = { parse: [] as never[], repliedUser: false };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function ticketErrorText(code: string) {
  return ({
    TICKETS_PENDING_APPROVAL: 'Support tickets aren’t available yet. Please contact a moderator.',
    ACTIVE_TICKET_LIMIT: 'You already have the maximum number of active tickets. Please continue in your existing support channel.',
    TICKET_ACTION_LIMIT: 'This ticket has changed several times recently. Please wait a minute before trying again.',
    TICKET_HOURLY_LIMIT: 'You’ve opened several tickets recently. Please wait before opening another one.',
    TICKET_NOT_FOUND: 'This ticket isn’t available to your account.',
    STAFF_ROLE_REQUIRED: 'This action is for authorized support staff.',
    TICKET_CHANGED: 'This ticket changed while you were working. Please refresh and try again.',
    REOPEN_WINDOW_EXPIRED: 'The reopening window has ended. Please submit a new ticket if you still need help.',
    TICKET_ALREADY_ASSIGNED: 'Another staff member has already claimed this ticket.',
    TICKET_NOT_READY: 'Your earlier request still needs a staff check. Please contact a moderator rather than submitting it again.',
    TICKET_CHANNEL_MISSING: 'This old ticket has no active private channel. Please open a new request.',
    TICKET_NOT_CLOSED: 'This ticket is already open.',
    TICKET_PANEL_CHANNEL: 'Run this command in the published help-desk channel.',
    TICKET_PANEL_UNKNOWN: 'The panel’s last update could not be confirmed. Check the help-desk before explicitly replacing it; no automatic repost was attempted.',
    PRIVATE_CHANNEL_PROVISION_FAILED: 'I couldn’t open a private support channel. Please contact a moderator.',
    TICKET_PROVISION_UNKNOWN: 'I couldn’t confirm whether your channel was created. Please ask a moderator to check before trying again.',
  } as Record<string, string>)[code];
}
async function staff(service: CommunityService, user: string): Promise<Actor> {
  if (!service.transport.ticketStaff) throw new AppError(403, 'STAFF_ROLE_REQUIRED');
  return service.transport.ticketStaff(user);
}
async function selectTopic(interaction: ChatInputCommandInteraction | ButtonInteraction, service: CommunityService) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const c = (await service.current()).body;
  if (!c.enabled.tickets || !c.channels.ticketCategory) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
  await interaction.editReply({ content: 'What can we help you with? Choose a topic to open a private ticket.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:type').setPlaceholder('Choose a support topic').addOptions(ticketCategories.map((label, index) => ({ label, value: ticketCategoryKeys[index] }))))], allowedMentions: noMentions });
}
export async function handleTicketInteraction(interaction: Interaction, service: CommunityService, env: Env): Promise<boolean> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) return false;
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') { await selectTopic(interaction, service); return true; }
  if (interaction.isButton() && interaction.customId === 'ticket:new') { await selectTopic(interaction, service); return true; }
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-panel') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const actor = await staff(service, interaction.user.id);
    service.require(actor, 'config');
    if (interaction.channelId !== (await service.current()).body.channels.helpDesk) throw new AppError(409, 'TICKET_PANEL_CHANNEL');
    const panel = await service.publishTicketPanel(actor, interaction.options.getBoolean('replace') ?? false);
    await interaction.editReply({ content: `Support panel is ready: https://discord.com/channels/${env.DISCORD_GUILD_ID}/${panel.channel}/${panel.messageId}`, allowedMentions: noMentions });
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type') {
    const key = interaction.values[0];
    if (!ticketCategoryKeys.some(value => value === key)) throw new AppError(400, 'VALIDATION_ERROR');
    const modal = new ModalBuilder().setCustomId(`ticket:create:${key}`).setTitle('Private support request');
    modal.addComponents(...[
      new TextInputBuilder().setCustomId('summary').setLabel('Briefly describe the issue').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(120).setRequired(true),
      new TextInputBuilder().setCustomId('description').setLabel('What happened? What did you expect?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(3000).setRequired(true),
      new TextInputBuilder().setCustomId('environment').setLabel('Device, browser or version (optional)').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false),
    ].map(field => new ActionRowBuilder<TextInputBuilder>().addComponents(field)));
    // No database/network access before this modal acknowledgement.
    await interaction.showModal(modal);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = interaction.customId.split(':')[2];
    const index = ticketCategoryKeys.findIndex(value => value === key);
    const category = index >= 0 ? ticketCategories[index] : interaction.customId === 'ticket:create' ? interaction.fields.getTextInputValue('category') : '';
    const ticket = await service.createTicket(interaction.user.id, interaction.id, { category, summary: interaction.fields.getTextInputValue('summary'), description: interaction.fields.getTextInputValue('description'), environment: index >= 0 ? interaction.fields.getTextInputValue('environment') : '' });
    if (!ticket.private_channel_id || !['OPEN','INVESTIGATING','WAITING_USER','RESOLVED'].includes(ticket.status)) throw new AppError(409, 'TICKET_NOT_READY');
    await interaction.editReply({ content: `Your private ticket #${ticket.seq} is ready. Add screenshots or videos in the support channel when needed.`, components: ticket.private_channel_id ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open your ticket').setURL(`https://discord.com/channels/${env.DISCORD_GUILD_ID}/${ticket.private_channel_id}`))] : [], allowedMentions: noMentions });
    return true;
  }
  if (interaction.isButton() && interaction.customId === 'ticket:cancel') {
    await interaction.update({ content: 'No changes made.', components: [], allowedMentions: noMentions }); return true;
  }
  if (interaction.isButton() && /^ticket:(close|confirm-close|reopen|staff):/.test(interaction.customId)) {
    const [, action, id] = interaction.customId.split(':');
    if (!uuid.test(id)) throw new AppError(400, 'VALIDATION_ERROR');
    if (action === 'confirm-close') await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rows = await service.db.query('SELECT creator_id,private_channel_id FROM ticket WHERE id=$1', [id]);
    if (!rows.length || rows[0].private_channel_id !== interaction.channelId) throw new AppError(404, 'TICKET_NOT_FOUND');
    const owner = rows[0].creator_id === interaction.user.id;
    const actor = owner && action !== 'staff' ? null : await staff(service, interaction.user.id);
    if (actor) await service.ticket(actor, id);
    if (action === 'close') {
      await interaction.editReply({ content: 'Close this ticket? The conversation will become read-only after synchronization. You can reopen it within the configured window.', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ticket:confirm-close:${id}`).setLabel('Confirm close').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('ticket:cancel').setLabel('Keep open').setStyle(ButtonStyle.Secondary))], allowedMentions: noMentions }); return true;
    }
    if (action === 'staff') {
      await interaction.editReply({ content: 'Choose the next step. Internal notes and assignments can also be managed in the console.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`ticket:staff-action:${id}`).setPlaceholder('Support action').addOptions([{ label: 'Claim ticket', value: 'claim' }, { label: 'Investigating', value: 'INVESTIGATING' }, { label: 'Waiting for user', value: 'WAITING_USER' }, { label: 'Resolved', value: 'RESOLVED' }]))], allowedMentions: noMentions }); return true;
    }
    const status = action === 'reopen' ? 'OPEN' : 'CLOSED';
    const ticket = actor ? await service.updateTicket(actor, id, { status, note: `${status} by staff in Discord`, expectedVersion: Number((await service.ticket(actor, id)).revision) }) : await service.memberTicketAction(interaction.user.id, id, status, `${status} by requester in Discord`);
    await interaction.editReply({ content: `Ticket #${ticket.seq} is ${status === 'OPEN' ? 'reopened' : 'closed'}. The status card and channel access are synchronizing.`, components: [], allowedMentions: noMentions }); return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:staff-action:')) {
    await interaction.deferUpdate();
    const id = interaction.customId.slice('ticket:staff-action:'.length);
    if (!uuid.test(id)) throw new AppError(400, 'VALIDATION_ERROR');
    const actor = await staff(service, interaction.user.id);
    const ticket = await service.ticket(actor, id);
    if (ticket.private_channel_id !== interaction.channelId) throw new AppError(404, 'TICKET_NOT_FOUND');
    const action = interaction.values[0];
    if (!['claim','INVESTIGATING','WAITING_USER','RESOLVED'].includes(action)) throw new AppError(400, 'VALIDATION_ERROR');
    if (action === 'claim' && ticket.assigned_to && ticket.assigned_to !== actor.id) throw new AppError(409, 'TICKET_ALREADY_ASSIGNED');
    await service.updateTicket(actor, id, { status: action === 'claim' ? 'INVESTIGATING' : action, ...(action === 'claim' ? { assignedTo: actor.id } : {}), note: `Staff action: ${action}`, expectedVersion: Number(ticket.revision) });
    await interaction.editReply({ content: `Ticket #${ticket.seq} updated. The shared status card and channel access are synchronizing.`, components: [], allowedMentions: noMentions }); return true;
  }
  return false;
}

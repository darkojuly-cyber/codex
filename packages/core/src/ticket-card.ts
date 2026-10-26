import { ButtonStyle, ComponentType, escapeMarkdown, type APIEmbed, type APIActionRowComponent, type APIButtonComponent } from 'discord.js';

export { ticketCategories, ticketCategoryKeys, ticketStatuses, ticketPriorities } from './ticket-config.js';
const safe = (value: unknown) => escapeMarkdown(String(value ?? '')).replaceAll('@', '@\u200b');
export function ticketPanelCard() {
  return { embeds: [{ color: 0xa78bfa, title: '🎫 Need a hand?', description: 'Tell us what’s happening and we’ll help you find the next step.\n\nChoose a topic, describe the issue, and Mimo will open a private support channel. You can add screenshots or videos there.\n\nPlease don’t include passwords, tokens, payment details or recovery codes.', footer: { text: 'Private support · Your ticket is visible to you and authorized staff.' } }], components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Primary, label: 'Submit a Ticket', custom_id: 'ticket:new' }] }] };
}
export function ticketCard(ticket: Record<string, unknown>): { embeds: APIEmbed[]; components: APIActionRowComponent<APIButtonComponent>[] } {
  const closed = ticket.status === 'CLOSED';
  const labels: Record<string, string> = { OPEN: 'Open', INVESTIGATING: 'Investigating', WAITING_USER: 'Waiting for your reply', RESOLVED: 'Resolved', CLOSED: 'Closed' };
  return { embeds: [{ color: closed ? 0x8891a5 : ticket.status === 'RESOLVED' ? 0x56b887 : 0xa78bfa,
    title: `🎫 Ticket #${ticket.seq} · ${safe(ticket.summary).slice(0, 180)}`,
    description: safe(ticket.description).slice(0, 3200),
    fields: [
      { name: 'Status', value: labels[String(ticket.status)] ?? safe(ticket.status), inline: true },
      { name: 'Topic', value: safe(ticket.category), inline: true },
      { name: 'Assigned to', value: ticket.assigned_to ? `<@${ticket.assigned_to}>` : 'Support team', inline: true },
      ...(ticket.environment ? [{ name: 'Device / environment', value: safe(ticket.environment).slice(0, 1000) }] : []),
    ],
    footer: { text: closed ? `This conversation becomes read-only after synchronization. Reopen within ${Number(ticket.reopen_days ?? 7)} days if you need more help.` : 'Add screenshots or details here. Internal staff notes are kept in the console.' },
  }], components: [{ type: ComponentType.ActionRow, components: [
    { type: ComponentType.Button, style: closed ? ButtonStyle.Primary : ButtonStyle.Secondary, label: closed ? 'Reopen ticket' : 'Close ticket', custom_id: `ticket:${closed ? 'reopen' : 'close'}:${ticket.id}` },
    { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Staff actions', custom_id: `ticket:staff:${ticket.id}` },
  ] }] };
}

import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, type Database } from '../packages/db/src.js';
import { CommunityService } from '../packages/core/src/service.js';
import { DeliveryError, MockTransport } from '../packages/core/src/transport.js';
import { ticketCard } from '../packages/core/src/ticket-card.js';
import type { Actor } from '../packages/core/src/config.js';

let db: Database;
let service: CommunityService;
let transport: MockTransport;
const admin: Actor = { id: '123456789012345678', role: 'SUPER_ADMIN' };
const support: Actor = { id: '223456789012345678', role: 'SUPPORT' };
const owner = '323456789012345678';
const input = { category: 'Bug', summary: 'Cannot start a game', description: 'The game shows a blank screen after pressing start.', environment: 'Windows · Chrome' };
const create = () => service.createTicket(owner, randomUUID(), input);
beforeAll(async () => { db = await openDatabase(process.env.TEST_DATABASE_URL, 'memory://'); await migrate(db); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE ticket,ticket_event,ticket_reply,ticket_panel,xp_ledger,xp_rule_revision,xp_boost_state,xp_participant,config_revision,audit_log,event_outbox RESTART IDENTITY CASCADE');
  transport = new MockTransport(); service = new CommunityService(db, transport); await service.initialize();
  const current = await service.current();
  const config = structuredClone(current.body); config.enabled.tickets = true; config.channels.ticketCategory = '523456789012345678'; config.channels.helpDesk = '623456789012345678';
  const draft = await service.createDraft(admin, config); await service.publish(admin, draft.id, current.version);
});

it('assigns privately, preserves internal notes, synchronizes closing and allows only the requester to reopen', async () => {
  const ticket = await create();
  await service.updateTicket(admin, ticket.id, { status: 'INVESTIGATING', assignedTo: support.id, note: 'Private investigation note', expectedVersion: 1 });
  await service.syncTickets();
  expect(transport.channels.get(ticket.private_channel_id!)).toMatchObject({ private: true, assignedTo: support.id, closed: false });
  expect((await service.ticket(support, ticket.id)).assigned_to).toBe(support.id);
  await service.updateTicket(support, ticket.id, { status: 'WAITING_USER', note: 'INTERNAL SECRET: investigation evidence', expectedVersion: 2 });
  expect(JSON.stringify(ticketCard(await service.ticket(admin, ticket.id)))).not.toContain('INTERNAL SECRET');
  expect((await service.ticket(admin, ticket.id)).events.some(event => JSON.stringify(event.detail).includes('INTERNAL SECRET'))).toBe(true);
  await service.updateTicket(admin, ticket.id, { assignedTo: null, note: 'Reassign to another staff member', expectedVersion: 3 });
  await service.syncTickets();
  await expect(service.ticket(support, ticket.id)).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  await expect(service.memberTicketAction('723456789012345678', ticket.id, 'CLOSED', 'Not my ticket')).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  await service.memberTicketAction(owner, ticket.id, 'CLOSED', 'Requester confirmed completion');
  await service.syncTickets();
  expect(transport.channels.get(ticket.private_channel_id!)).toMatchObject({ closed: true });
  for (let i = 0; i < 4; i++) await service.sendTicketReply();
  expect(transport.sent.some(item => item.body.includes('INTERNAL SECRET'))).toBe(false);
  expect(transport.sent.some(item => item.body.includes('is closed'))).toBe(true);
  await service.memberTicketAction(owner, ticket.id, 'OPEN', 'More information is available');
  await service.syncTickets();
  expect(transport.channels.get(ticket.private_channel_id!)).toMatchObject({ closed: false });
});

it('guards stale edits and does not extend the reopening window when adding notes to a closed ticket', async () => {
  const ticket = await create();
  await service.updateTicket(admin, ticket.id, { status: 'CLOSED', note: 'Closed after confirmation', expectedVersion: 1 });
  await expect(service.updateTicket(admin, ticket.id, { status: 'OPEN', note: 'Stale browser request', expectedVersion: 1 })).rejects.toMatchObject({ code: 'TICKET_CHANGED' });
  await db.query("UPDATE ticket SET closed_at=now()-interval '8 days' WHERE id=$1", [ticket.id]);
  const old = (await service.ticket(admin, ticket.id)).closed_at;
  await service.updateTicket(admin, ticket.id, { status: 'CLOSED', note: 'Additional internal information' });
  expect((await service.ticket(admin, ticket.id)).closed_at).toEqual(old);
  await expect(service.memberTicketAction(owner, ticket.id, 'OPEN', 'Try reopening expired ticket')).rejects.toMatchObject({ code: 'REOPEN_WINDOW_EXPIRED' });
});

it('deduplicates staff replies and never blindly retries an uncertain Discord send', async () => {
  const ticket = await create();
  const request = { body: 'Please send the browser version in this private channel.', requestKey: randomUUID() };
  const first = await service.replyTicket(admin, ticket.id, request);
  expect((await service.replyTicket(admin, ticket.id, request)).id).toBe(first.id);
  await expect(service.replyTicket(admin, ticket.id, { ...request, body: 'Different reply' })).rejects.toMatchObject({ code: 'TICKET_REPLY_KEY_CONFLICT' });
  await expect(service.replyTicket(support, ticket.id, { ...request, requestKey: randomUUID() })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  await db.query("UPDATE ticket SET sync_status='PENDING' WHERE id=$1", [ticket.id]);
  const sentBeforeSync = transport.sent.length;
  await service.sendTicketReply();
  expect(transport.sent).toHaveLength(sentBeforeSync);
  expect((await db.query('SELECT status FROM ticket_reply WHERE id=$1', [first.id]))[0].status).toBe('PENDING');
  await service.syncTickets();
  const send = vi.spyOn(transport, 'send').mockRejectedValue(new DeliveryError('OUTCOME_UNKNOWN', 'ambiguous'));
  await service.sendTicketReply(); await service.sendTicketReply();
  expect(send).toHaveBeenCalledTimes(1);
  expect((await db.query('SELECT status FROM ticket_reply WHERE id=$1', [first.id]))[0].status).toBe('UNKNOWN');
});

it('keeps uncertain provisioning for operator review and never creates another channel on replay', async () => {
  const original = transport.createTicket.bind(transport);
  const createChannel = vi.spyOn(transport, 'createTicket').mockRejectedValue(new DeliveryError('UNCONFIRMED', 'ambiguous'));
  const key = randomUUID();
  await expect(service.createTicket(owner, key, input)).rejects.toMatchObject({ code: 'TICKET_PROVISION_UNKNOWN' });
  const ticket = await service.createTicket(owner, key, input);
  expect(ticket.status).toBe('UNKNOWN'); expect(createChannel).toHaveBeenCalledTimes(1);
  await expect(service.reviewUncertainTicket(support, ticket.id, { confirm: true, note: 'I checked the server', expectedVersion: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await service.reviewUncertainTicket(admin, ticket.id, { confirm: true, note: 'Checked and handled any orphaned private channel', expectedVersion: 1 });
  expect((await service.ticket(admin, ticket.id)).status).toBe('CLOSED');
  await expect(service.memberTicketAction(owner, ticket.id, 'OPEN', 'Try reopening missing channel')).rejects.toMatchObject({ code: 'TICKET_CHANNEL_MISSING' });
  createChannel.mockImplementation(original);
  expect((await create()).status).toBe('OPEN');
});

it('updates one persistent help-desk panel, and blocks an automatic repost after an uncertain result', async () => {
  const first = await service.publishTicketPanel(admin);
  expect((await service.publishTicketPanel(admin)).messageId).toBe(first.messageId);
  expect(transport.sent).toHaveLength(1);
  await db.query('DELETE FROM ticket_panel');
  const publish = vi.spyOn(transport, 'publishTicketPanel').mockRejectedValue(new Error('Unknown remote outcome'));
  await expect(service.publishTicketPanel(admin)).rejects.toMatchObject({ code: 'TICKET_PANEL_UNKNOWN' });
  await expect(service.publishTicketPanel(admin)).rejects.toMatchObject({ code: 'TICKET_PANEL_UNKNOWN' });
  expect(publish).toHaveBeenCalledTimes(1);
});

it('paginates filtered inboxes and history without revealing other tickets to Support', async () => {
  let ticket = await create();
  for (let i = 0; i < 20; i++) await service.createTicket(String(823456789012345600n + BigInt(i)), randomUUID(), { ...input, summary: `Search report ${i}` });
  expect((await service.ticketSearch(admin, {})).entries).toHaveLength(20);
  expect((await service.ticketSearch(admin, { page: 2 })).entries).toHaveLength(1);
  expect((await service.ticketSearch(support, {})).total).toBe(0);
  expect((await service.ticketSearch(admin, { search: 'report', priority: 'NORMAL' })).total).toBe(20);
  ticket = await service.updateTicket(admin, ticket.id, { assignedTo: support.id, note: 'Assign this case' });
  expect((await service.ticketSearch(support, {})).total).toBe(1);
  for (let i = 0; i < 22; i++) await service.updateTicket(admin, ticket.id, { note: `Internal note ${i}` });
  const history = await service.ticket(support, ticket.id, 2);
  expect(history.eventCount).toBe(23); expect(history.events).toHaveLength(3);
});

it('awards a confirmed unique issue once and excludes private ticket conversations from chat points', async () => {
  const ticket = await create();
  const current = await service.xp.current();
  const config = { ...current.body, enabled: true, excludedCategoryIds: [] };
  const draft = await service.xp.draft(admin, { config, reason: 'Approved ticket contribution points' });
  await service.xp.approve(admin, String(draft.id)); await service.xp.publish(admin, String(draft.id), current.version);
  expect((await service.awardTicket(admin, ticket.id, { confirm: true, reason: 'Verified a unique reproducible issue' })).amount).toBe(3);
  expect((await service.awardTicket(admin, ticket.id, { confirm: true, reason: 'Verified the same issue again' })).reason).toBe('DUPLICATE_EVENT');
  expect((await service.xp.summary(owner)).lifetimeXp).toBe(3);
  const privateChannel = '923456789012345678';
  await db.query('UPDATE ticket SET private_channel_id=$2 WHERE id=$1', [ticket.id, privateChannel]);
  const message = { user: owner, messageId: '723456789012345678', channelId: privateChannel, content: 'Private support conversation must never earn chat points', occurredAt: new Date(), bot: false, categoryId: null, announcement: false };
  expect((await service.xp.message(message)).reason).toBe('TICKET_CHANNEL_EXCLUDED');
  expect((await service.xp.message({ ...message, channelId: '823456789012345678', parentChannelId: privateChannel })).reason).toBe('TICKET_CHANNEL_EXCLUDED');
  expect((await service.xp.message({ ...message, channelId: '623456789012345678' })).amount).toBe(10);
});

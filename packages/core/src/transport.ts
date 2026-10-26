import { REST, Routes, ChannelType, PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { AppError } from './config.js';
import type { Env } from './env.js';
import { ticketCard, ticketPanelCard } from './ticket-card.js';
import { ids } from './env.js';
import { welcomeCard, type WelcomeAppearance } from './welcome-card.js';

type SendOptions = (WelcomeAppearance & { welcomeCard: boolean; mentionUser: string }) | { ticketCard: Record<string, unknown> };

export class DeliveryError extends Error {
  constructor(public code: string, public kind: 'retry' | 'permanent' | 'ambiguous', public retryAfter = 5) { super(code); }
}
export interface Transport {
  send(channelId: string, body: string, key: string, options?: SendOptions): Promise<string>;
  createTicket(userId: string, categoryId: string, seq: number): Promise<string>;
  deleteTicket(channelId: string): Promise<void>;
  auditGuild(): Promise<unknown>;
  syncTicket(channel: string, cardId: string | null, ticket: Record<string, unknown>): Promise<void>;
  publishTicketPanel(channel: string, messageId: string | null): Promise<string>;
  ticketStaff?(user: string): Promise<import('./config.js').Actor>;
  xpParticipant?(user: string): Promise<{ canEarn: boolean; canRank: boolean }>;
}
export class MockTransport implements Transport {
  sent: { channelId: string; body: string; key: string; id: string }[] = [];
  channels = new Map<string, { creator: string; private: boolean }>();
  async send(channelId: string, body: string, key: string) {
    const previous = this.sent.find(item => item.key === key);
    if (previous) return previous.id;
    const id = `mock-${randomUUID()}`;
    this.sent.push({ channelId, body, key, id });
    return id;
  }
  async createTicket(userId: string) { const id = `mock-${randomUUID()}`; this.channels.set(id, { creator: userId, private: true }); return id; }
  async deleteTicket(channelId: string) { this.channels.delete(channelId); }
  async syncTicket(channel: string, _cardId: string | null, ticket: Record<string, unknown>) {
    const value = this.channels.get(channel);
    if (value) Object.assign(value, { assignedTo: ticket.assigned_to, closed: ticket.status === 'CLOSED' });
  }
  async publishTicketPanel(channel: string, messageId: string | null) { return messageId ?? this.send(channel, 'Private support · Submit a Ticket', randomUUID()); }
  async auditGuild() { return { mode: 'MOCK', channels: [], roles: [], warning: 'No Discord connection. Nothing was synchronized.' }; }
}
export class DiscordTransport implements Transport {
  readonly rest: REST;
  constructor(private env: Env) { this.rest = new REST({ version: '10', retries: 0, timeout: 15000 }).setToken(env.DISCORD_TOKEN!); }
  private writable() { if (this.env.DISCORD_WRITES_ENABLED !== 'true') throw new AppError(409, 'DISCORD_WRITES_DISABLED'); }
  async send(channelId: string, body: string, key: string, options?: SendOptions) {
    this.writable();
    if (!await this.channelBelongsToGuild(channelId)) throw new DeliveryError('CHANNEL_OUTSIDE_GUILD', 'permanent');
    // Stable nonce, enforced by Discord for recent duplicate messages. Longer ambiguous failures
    // require manual reconciliation rather than claiming exactly-once delivery across systems.
    const welcome = options && 'welcomeCard' in options ? options : undefined;
    const ticket = options && 'ticketCard' in options ? options.ticketCard : undefined;
    const nonce = key.replace(/-/g, '').slice(0, 25);
    try {
      const message = await this.rest.post(Routes.channelMessages(channelId), { body: { content: welcome?.welcomeCard ? `<@${welcome.mentionUser}>` : body,
        allowed_mentions: { parse: [], users: welcome?.mentionUser ? [welcome.mentionUser] : [], roles: [], replied_user: false }, nonce, enforce_nonce: true,
        ...(welcome?.welcomeCard ? welcomeCard(body, welcome) : {}),
        ...(ticket ? { content: undefined, ...ticketCard(ticket) } : {}),
      } }) as { id: string };
      return message.id;
    } catch (e) {
      const error = e as { status?: number; code?: number; rawError?: { retry_after?: number } };
      if (error.status === 429) throw new DeliveryError('RATE_LIMITED', 'retry', error.rawError?.retry_after ?? 5);
      if (error.status && error.status >= 400 && error.status < 500) throw new DeliveryError(`DISCORD_${error.code ?? error.status}`, 'permanent');
      throw new DeliveryError('DELIVERY_OUTCOME_UNKNOWN', 'ambiguous');
    }
  }
  async createTicket(userId: string, categoryId: string, seq: number) {
    this.writable();
    const staff = [...new Set([...ids(this.env.STAFF_ROLE_IDS), ...ids(this.env.MODERATOR_ROLE_IDS)])];
    if (!categoryId || (!staff.length && !ids(this.env.SUPER_ADMIN_USER_IDS).length) || staff.includes(this.env.DISCORD_GUILD_ID!)) throw new AppError(409, 'TICKET_BINDINGS_REQUIRED');
    const parent = await this.rest.get(Routes.channel(categoryId)) as { type: number; guild_id: string };
    if (parent.type !== ChannelType.GuildCategory || parent.guild_id !== this.env.DISCORD_GUILD_ID) throw new AppError(409, 'INVALID_TICKET_CATEGORY');
    const me = await this.rest.get(Routes.user()) as { id: string };
    const view = PermissionFlagsBits.ViewChannel;
    const access = view | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles;
    let channel: { id: string };
    try { channel = await this.rest.post(Routes.guildChannels(this.env.DISCORD_GUILD_ID!), { body: {
      name: `ticket-${String(seq).padStart(6, '0')}`, type: ChannelType.GuildText, parent_id: categoryId,
      permission_overwrites: [
        { id: this.env.DISCORD_GUILD_ID, type: 0, deny: view.toString(), allow: '0' },
        ...staff.map(id => ({ id, type: 0, allow: access.toString(), deny: '0' })),
        ...ids(this.env.SUPER_ADMIN_USER_IDS).filter(id => id !== userId && id !== me.id).map(id => ({ id, type: 1, allow: access.toString(), deny: '0' })),
        { id: userId, type: 1, allow: access.toString(), deny: '0' },
        { id: me.id, type: 1, allow: access.toString(), deny: '0' },
      ],
    } }) as { id: string }; }
    catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) throw new DeliveryError('TICKET_CHANNEL_REJECTED', 'permanent');
      throw new DeliveryError('TICKET_PROVISION_UNKNOWN', 'ambiguous');
    }
    if (!channel.id) throw new DeliveryError('TICKET_PROVISION_UNKNOWN', 'ambiguous');
    return channel.id;
  }
  async ticketStaff(user: string): Promise<import('./config.js').Actor> {
    const member = await this.rest.get(Routes.guildMember(this.env.DISCORD_GUILD_ID!, user)) as { roles: string[]; user?: { bot?: boolean } };
    if (member.user?.bot) throw new AppError(403, 'STAFF_ROLE_REQUIRED');
    const roles = await this.participantRoles();
    const permission = [this.env.DISCORD_GUILD_ID!, ...member.roles].reduce((bits, id) => bits | (roles.permissions.get(id) ?? 0n), 0n);
    if (roles.owner === user || ids(this.env.SUPER_ADMIN_USER_IDS).includes(user) || (permission & PermissionFlagsBits.Administrator) !== 0n) return { id: user, role: 'SUPER_ADMIN' };
    if (member.roles.some(id => ids(this.env.STAFF_ROLE_IDS).includes(id))) return { id: user, role: 'COMMUNITY_MANAGER' };
    if (member.roles.some(id => ids(this.env.MODERATOR_ROLE_IDS).includes(id))) return { id: user, role: 'MODERATOR' };
    if (member.roles.some(id => ids(this.env.SUPPORT_ROLE_IDS).includes(id))) return { id: user, role: 'SUPPORT' };
    if ((permission & (PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ModerateMembers)) !== 0n) return { id: user, role: 'MODERATOR' };
    throw new AppError(403, 'STAFF_ROLE_REQUIRED');
  }
  async syncTicket(channelId: string, cardId: string | null, ticket: Record<string, unknown>) {
    this.writable();
    if (!await this.channelBelongsToGuild(channelId)) throw new AppError(409, 'CHANNEL_OUTSIDE_GUILD');
    const me = await this.rest.get(Routes.user()) as { id: string };
    const access = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles;
    const readOnly = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.AddReactions | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads;
    const owner = String(ticket.creator_id);
    const staff = [...new Set([...ids(this.env.STAFF_ROLE_IDS), ...ids(this.env.MODERATOR_ROLE_IDS)])];
    const users = [...new Set([me.id, ...ids(this.env.SUPER_ADMIN_USER_IDS), ...(ticket.assigned_to ? [String(ticket.assigned_to)] : [])])].filter(id => id !== owner);
    await this.rest.patch(Routes.channel(channelId), { body: { permission_overwrites: [
      { id: this.env.DISCORD_GUILD_ID!, type: 0, deny: PermissionFlagsBits.ViewChannel.toString(), allow: '0' },
      ...staff.map(id => ({ id, type: 0, allow: access.toString(), deny: '0' })),
      ...users.map(id => ({ id, type: 1, allow: access.toString(), deny: '0' })),
      { id: owner, type: 1, allow: (ticket.status === 'CLOSED' ? PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory : access).toString(), deny: ticket.status === 'CLOSED' ? readOnly.toString() : '0' },
    ] } });
    // Legacy tickets may predate the status card. Update permissions without posting a duplicate.
    if (cardId) await this.rest.patch(Routes.channelMessage(channelId, cardId), { body: { content: null, ...ticketCard(ticket), allowed_mentions: { parse: [], replied_user: false } } });
  }
  async publishTicketPanel(channelId: string, messageId: string | null) {
    this.writable();
    if (!await this.channelBelongsToGuild(channelId)) throw new AppError(409, 'CHANNEL_OUTSIDE_GUILD');
    const body = { ...ticketPanelCard(), allowed_mentions: { parse: [], replied_user: false } };
    if (messageId) {
      const old = await this.rest.get(Routes.channelMessage(channelId, messageId)) as { author?: { id: string }; components?: { components?: { custom_id?: string }[] }[] };
      const me = await this.rest.get(Routes.user()) as { id: string };
      if (old.author?.id !== me.id || !old.components?.some(row => row.components?.some(component => component.custom_id === 'ticket:new'))) throw new AppError(409, 'TICKET_PANEL_NOT_OWNED');
      const message = await this.rest.patch(Routes.channelMessage(channelId, messageId), { body }) as { id: string };
      return message.id;
    }
    const message = await this.rest.post(Routes.channelMessages(channelId), { body }) as { id: string };
    return message.id;
  }
  async deleteTicket(channelId: string) { this.writable(); await this.rest.delete(Routes.channel(channelId)); }
  async auditGuild() {
    const guildId = this.env.DISCORD_GUILD_ID!;
    const [channels, roles, guild] = await Promise.all([
      this.rest.get(Routes.guildChannels(guildId)), this.rest.get(Routes.guildRoles(guildId)), this.rest.get(Routes.guild(guildId)),
    ]);
    return { mode: 'DISCORD_READ_ONLY', channels, roles, guild, note: 'Raw permissions only. Effective permissions must be reviewed before enabling features. No writes performed.' };
  }
  private xpRoles?: { expires: number; owner: string; permissions: Map<string, bigint> };
  private xpRolesRequest?: Promise<{ expires: number; owner: string; permissions: Map<string, bigint> }>;
  invalidateXpRoles() { this.xpRoles = undefined; }
  private async participantRoles() {
    if (this.xpRoles && this.xpRoles.expires > Date.now()) return this.xpRoles;
    if (!this.xpRolesRequest) this.xpRolesRequest = Promise.all([
      this.rest.get(Routes.guildRoles(this.env.DISCORD_GUILD_ID!)),
      this.rest.get(Routes.guild(this.env.DISCORD_GUILD_ID!)),
    ]).then(([roles, guild]) => {
      const value = { expires: Date.now() + 30000, owner: (guild as { owner_id: string }).owner_id,
        permissions: new Map((roles as { id: string; permissions: string }[]).map(role => [role.id, BigInt(role.permissions)])) };
      this.xpRoles = value; return value;
    }).finally(() => { this.xpRolesRequest = undefined; });
    return this.xpRolesRequest;
  }
  async xpParticipant(user: string): Promise<{ canEarn: boolean; canRank: boolean }> {
    let member: { roles: string[]; user?: { bot?: boolean } };
    try { member = await this.rest.get(Routes.guildMember(this.env.DISCORD_GUILD_ID!, user)) as typeof member; }
    catch (error) { if ((error as { status?: number }).status === 404) return { canEarn: false, canRank: false }; throw error; }
    if (member.user?.bot) return { canEarn: false, canRank: false };
    if (ids(this.env.SUPER_ADMIN_USER_IDS).includes(user)) return { canEarn: true, canRank: false };
    let roles = await this.participantRoles();
    if ([this.env.DISCORD_GUILD_ID!, ...member.roles].some(role => !roles.permissions.has(role))) {
      this.invalidateXpRoles(); roles = await this.participantRoles();
      if ([this.env.DISCORD_GUILD_ID!, ...member.roles].some(role => !roles.permissions.has(role))) throw new Error('Member roles could not be verified');
    }
    const admin = roles.owner === user || [this.env.DISCORD_GUILD_ID!, ...member.roles].some(role => ((roles.permissions.get(role) ?? 0n) & PermissionFlagsBits.Administrator) !== 0n);
    return { canEarn: true, canRank: !admin };
  }
  async boostSince(user: string): Promise<Date | null> {
    try {
      const member = await this.rest.get(Routes.guildMember(this.env.DISCORD_GUILD_ID!, user)) as { premium_since: string | null; user?: { bot?: boolean } };
      return member.user?.bot || !member.premium_since ? null : new Date(member.premium_since);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }
  async channelBelongsToGuild(id: string) {
    const channel = await this.rest.get(Routes.channel(id)) as { guild_id?: string; type: number };
    return channel.guild_id === this.env.DISCORD_GUILD_ID && channel.type === ChannelType.GuildText;
  }
}

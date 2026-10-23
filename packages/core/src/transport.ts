import { REST, Routes, ChannelType, PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { AppError } from './config.js';
import type { Env } from './env.js';
import { ids } from './env.js';
import { welcomeCard, type WelcomeAppearance } from './welcome-card.js';

type SendOptions = WelcomeAppearance & { welcomeCard: boolean; mentionUser: string };

export class DeliveryError extends Error {
  constructor(public code: string, public kind: 'retry' | 'permanent' | 'ambiguous', public retryAfter = 5) { super(code); }
}
export interface Transport {
  send(channelId: string, body: string, key: string, options?: SendOptions): Promise<string>;
  createTicket(userId: string, categoryId: string, seq: number): Promise<string>;
  deleteTicket(channelId: string): Promise<void>;
  auditGuild(): Promise<unknown>;
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
    const nonce = key.replace(/-/g, '').slice(0, 25);
    try {
      const message = await this.rest.post(Routes.channelMessages(channelId), { body: { content: options?.welcomeCard ? `<@${options.mentionUser}>` : body,
        allowed_mentions: { parse: [], users: options?.mentionUser ? [options.mentionUser] : [], roles: [], replied_user: false }, nonce, enforce_nonce: true,
        ...(options?.welcomeCard ? welcomeCard(body, options) : {}),
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
    const staff = [...new Set([...ids(this.env.STAFF_ROLE_IDS), ...ids(this.env.MODERATOR_ROLE_IDS), ...ids(this.env.SUPPORT_ROLE_IDS)])];
    if (!categoryId || !staff.length || staff.includes(this.env.DISCORD_GUILD_ID!)) throw new AppError(409, 'TICKET_BINDINGS_REQUIRED');
    const parent = await this.rest.get(Routes.channel(categoryId)) as { type: number; guild_id: string };
    if (parent.type !== ChannelType.GuildCategory || parent.guild_id !== this.env.DISCORD_GUILD_ID) throw new AppError(409, 'INVALID_TICKET_CATEGORY');
    const me = await this.rest.get(Routes.user()) as { id: string };
    const view = PermissionFlagsBits.ViewChannel;
    const access = view | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles;
    const channel = await this.rest.post(Routes.guildChannels(this.env.DISCORD_GUILD_ID!), { body: {
      name: `ticket-${String(seq).padStart(6, '0')}`, type: ChannelType.GuildText, parent_id: categoryId,
      permission_overwrites: [
        { id: this.env.DISCORD_GUILD_ID, type: 0, deny: view.toString(), allow: '0' },
        ...staff.map(id => ({ id, type: 0, allow: access.toString(), deny: '0' })),
        { id: userId, type: 1, allow: access.toString(), deny: '0' },
        { id: me.id, type: 1, allow: access.toString(), deny: '0' },
      ],
    } }) as { id: string };
    return channel.id;
  }
  async deleteTicket(channelId: string) { this.writable(); await this.rest.delete(Routes.channel(channelId)); }
  async auditGuild() {
    const guildId = this.env.DISCORD_GUILD_ID!;
    const [channels, roles, guild] = await Promise.all([
      this.rest.get(Routes.guildChannels(guildId)), this.rest.get(Routes.guildRoles(guildId)), this.rest.get(Routes.guild(guildId)),
    ]);
    return { mode: 'DISCORD_READ_ONLY', channels, roles, guild, note: 'Raw permissions only. Effective permissions must be reviewed before enabling features. No writes performed.' };
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

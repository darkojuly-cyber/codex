import { expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { defaults, type Config } from '../packages/core/src/config.js';
import { showWelcome, providerErrorDetails } from '../apps/discord-bot/src/welcome.js';

it('acknowledges welcome before waiting for a slow database and edits the private response', async () => {
  let finish!: (config: Config) => void;
  const slowDatabase = new Promise<Config>(resolve => { finish = resolve; });
  const events: string[] = [];
  const deferReply = vi.fn(async () => { events.push('acknowledged'); });
  const editReply = vi.fn(async () => {});
  const interaction = { user: { username: 'Alice' }, deferReply, editReply } as unknown as ChatInputCommandInteraction;
  const loadConfig = vi.fn(() => { events.push('database'); return slowDatabase; });
  const response = showWelcome(interaction, loadConfig);
  await Promise.resolve();
  expect(events).toEqual(['acknowledged', 'database']);
  expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(editReply).not.toHaveBeenCalled();
  finish(defaults);
  await response;
  expect(editReply.mock.calls).toHaveLength(1);
  expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
    content: defaults.persona.welcome.replaceAll('{user}', 'Alice'),
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
  }));
});

it('does not query the database if Discord rejects the initial acknowledgement', async () => {
  const error = { code: 10062, status: 404 };
  const loadConfig = vi.fn(async () => defaults);
  const interaction = { deferReply: vi.fn().mockRejectedValue(error) } as unknown as ChatInputCommandInteraction;
  await expect(showWelcome(interaction, loadConfig)).rejects.toBe(error);
  expect(loadConfig).not.toHaveBeenCalled();
});

it('logs only bounded diagnostic codes, never provider payloads or credential-bearing messages', () => {
  expect(providerErrorDetails({ code: 10062, status: 404, message: 'secret', requestBody: 'secret', url: 'secret' }))
    .toEqual({ providerCode: 10062, httpStatus: 404 });
  expect(providerErrorDetails({ code: 'ETIMEDOUT' }).providerCode).toBe('ETIMEDOUT');
  expect(providerErrorDetails({ code: '42P01' }).providerCode).toBe('42P01');
  expect(JSON.stringify(providerErrorDetails({ code: 'postgres://secret', message: 'secret', status: 'secret' }))).toBe('{}');
  expect(JSON.stringify(providerErrorDetails(null))).toBe('{}');
});

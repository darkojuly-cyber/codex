import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  APP_MODE: z.enum(['mock', 'discord']).default('mock'),
  DATABASE_URL: z.string().optional(), DATA_DIR: z.string().default('.data'),
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().default(3000),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
  DISCORD_TOKEN: z.string().optional(), DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(), DISCORD_CLIENT_SECRET: z.string().optional(), DISCORD_REDIRECT_URI: z.string().optional(),
  STAFF_ROLE_IDS: z.string().default(''), MODERATOR_ROLE_IDS: z.string().default(''), SUPPORT_ROLE_IDS: z.string().default(''), SUPER_ADMIN_USER_IDS: z.string().default(''),
  DISCORD_WRITES_ENABLED: z.enum(['true', 'false']).default('false'),
  GUILD_MEMBERS_INTENT: z.enum(['true', 'false']).default('false'),
});
export function readEnv() {
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const env = schema.parse(raw);
  if (env.APP_MODE === 'mock' && !['127.0.0.1', 'localhost', '::1'].includes(env.HOST)) throw new Error('Mock mode must bind to loopback only');
  if (env.APP_MODE === 'discord' && (!env.DATABASE_URL || !env.DISCORD_TOKEN || !env.DISCORD_GUILD_ID)) throw new Error('Discord mode requires PostgreSQL, DISCORD_TOKEN and DISCORD_GUILD_ID');
  if (env.APP_MODE === 'discord') {
    if (!/^\d{17,20}$/.test(env.DISCORD_GUILD_ID!)) throw new Error('Invalid Discord Guild Snowflake ID');
    if (new URL(env.PUBLIC_ORIGIN).protocol !== 'https:') throw new Error('Discord mode requires an HTTPS PUBLIC_ORIGIN');
    const roleIds = [...ids(env.STAFF_ROLE_IDS), ...ids(env.MODERATOR_ROLE_IDS), ...ids(env.SUPPORT_ROLE_IDS)];
    if (roleIds.some(id => !/^\d{17,20}$/.test(id) || id === env.DISCORD_GUILD_ID)) throw new Error('Role bindings must be valid IDs and must not include @everyone');
  }
  return env;
}
export type Env = ReturnType<typeof readEnv>;
export const ids = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean);

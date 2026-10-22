import { readEnv } from '../packages/core/src/env.js';
import { REST, Routes } from 'discord.js';
import { commands } from '../apps/discord-bot/src/commands.js';
const env = readEnv();
if (env.APP_MODE !== 'discord' || env.DISCORD_WRITES_ENABLED !== 'true' || !env.DISCORD_CLIENT_ID) throw new Error('Register only after sandbox approval: APP_MODE=discord, DISCORD_WRITES_ENABLED=true, configured Guild and Client IDs.');
try {
  await new REST({ version: '10' }).setToken(env.DISCORD_TOKEN!).put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID!), { body: commands });
  console.log('Registered /welcome, /idea, /ticket in configured guild only. No channels or roles changed.');
} catch { console.error('Guild command registration failed.'); process.exitCode = 1; }

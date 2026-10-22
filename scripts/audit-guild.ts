import { readEnv } from '../packages/core/src/env.js';
import { DiscordTransport, MockTransport } from '../packages/core/src/transport.js';
const env = readEnv();
const adapter = env.APP_MODE === 'mock' ? new MockTransport() : new DiscordTransport(env);
try { console.log(JSON.stringify(await adapter.auditGuild(), null, 2)); }
catch { console.error('Read-only guild audit failed. Check bindings and Discord access; no changes were made.'); process.exitCode = 1; }

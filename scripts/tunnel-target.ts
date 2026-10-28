import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../packages/core/src/load-env.js';
const env = { ...process.env };
loadEnvironment(env, resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(env.PORT || 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid local TCP port.');
process.stdout.write(`http://127.0.0.1:${port}`);

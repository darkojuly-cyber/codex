import { runtime } from '../../../packages/core/src/runtime.js';
import { readEnv } from '../../../packages/core/src/env.js';
if (readEnv().APP_MODE === 'mock') throw new Error('Mock worker is embedded in the API process. Use npm run dev.');
const { service, db } = await runtime();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
while (!stopping) {
  try { await service.tick(); } catch { console.error('Worker tick failed; no provider secrets logged.'); }
  await new Promise(r => setTimeout(r, 1000));
}
await db.close();

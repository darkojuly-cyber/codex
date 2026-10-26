import { runtime } from '../../../packages/core/src/runtime.js';
import { createApp } from './app.js';
const { service, env, db } = await runtime();
const app = await createApp(service, env);
let busy = false;
const timer = env.APP_MODE === 'mock' ? setInterval(async () => {
  if (busy) return;
  busy = true;
  try { await service.tick(); } catch { app.log.error('Local worker failed'); }
  finally { busy = false; }
}, 2000) : undefined;
app.addHook('onClose', async () => { clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 20)); await db.close(); });
let shutdownRequested = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  void app.close();
});
await app.listen({ host: env.HOST, port: env.PORT });

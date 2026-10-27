import { resolve } from 'node:path';
import { openDatabase, migrate } from '../../db/src.js';
import { readEnv } from './env.js';
import { CommunityService } from './service.js';
import { DiscordTransport, MockTransport } from './transport.js';

export async function runtime() {
  const env = readEnv();
  const db = await openDatabase(env.DATABASE_URL, resolve(env.DATA_DIR, 'postgres'));
  try {
    if (env.DATABASE_URL && env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED !== env.DATABASE_URL) {
      const migrationDb = await openDatabase(env.DATABASE_URL_UNPOOLED);
      try { await migrate(migrationDb); } finally { await migrationDb.close(); }
    } else {
      await migrate(db);
    }
    await db.transaction(async tx => {
      await tx.query('LOCK TABLE environment_binding IN EXCLUSIVE MODE');
      const identity = env.APP_MODE === 'mock' ? 'LOCAL_MOCK' : `DISCORD:${env.DISCORD_GUILD_ID}`;
      const [binding] = await tx.query('SELECT identity FROM environment_binding WHERE id=1');
      if (binding && binding.identity !== identity) throw new Error('Database belongs to another mode or Guild. Use a separate database; never mix mock and live data.');
      if (!binding) await tx.query('INSERT INTO environment_binding(id,identity) VALUES(1,$1)', [identity]);
    });
    const transport = env.APP_MODE === 'mock' ? new MockTransport() : new DiscordTransport(env, db);
    const service = new CommunityService(db, transport, env.APP_MODE === 'mock');
    await service.initialize();
    return { env, db, transport, service };
  } catch (error) {
    await db.close();
    throw error;
  }
}

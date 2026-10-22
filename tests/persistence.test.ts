import { it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate, type Database } from '../packages/db/src.js';
import { CommunityService } from '../packages/core/src/service.js';
import { MockTransport } from '../packages/core/src/transport.js';

it('restores local database files after closing the engine: config, tickets, welcome dedup and pending deliveries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evomeme-persistence-'));
  let db: Database | undefined;
  try {
    db = await openDatabase(undefined, dir); await migrate(db);
    await expect(openDatabase(undefined, dir)).rejects.toThrow('Local database is already open');
    const first = new CommunityService(db, new MockTransport()); await first.initialize();
    const admin = { id: 'admin', role: 'SUPER_ADMIN' as const };
    const current = await first.current();
    const config = structuredClone(current.body);
    config.enabled.messaging = true; config.enabled.welcome = true;
    config.channels.publish = ['123456789012345678']; config.channels.welcome = '123456789012345678';
    const draft = await first.createDraft(admin, config); await first.publish(admin, draft.id, current.version);
    const ticket = await first.createTicket('alice', 'durable-ticket', { category: 'Bug', summary: 'Restart persistence test', description: 'This support request must survive closing and reopening the local database.' });
    const cutoff = new Date(0); await first.welcome('alice', new Date(), true, cutoff);
    const job = await first.createJob(admin, { channelId: config.channels.welcome, body: 'Survives restart', scheduledAt: new Date().toISOString() }); await first.confirmJob(admin, String(job.id));
    await db.close(); db = undefined;
    // A process killed during a snapshot leaves its lock; only a confirmed absent
    // owning PID may be recovered. Linux PIDs cannot reach this test value.
    await writeFile(join(dir, '.evomeme.lock'), JSON.stringify({ pid: 2147483647, token: 'stale-test-only' }));
    db = await openDatabase(undefined, dir); await migrate(db);
    const transport = new MockTransport(); const restarted = new CommunityService(db, transport); await restarted.initialize();
    expect((await restarted.current()).version).toBe(draft.version);
    expect((await restarted.ticket(admin, ticket.id)).status).toBe('OPEN');
    expect(await restarted.welcome('alice', new Date(), true, cutoff)).toBe(false);
    await restarted.tick(); await restarted.tick(); expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].body).toBe('Survives restart');
    expect((await db.query('SELECT status FROM message_job WHERE id=$1', [job.id]))[0].status).toBe('SENT');
  } finally { await db?.close(); await rm(dir, { recursive: true, force: true }); }
});

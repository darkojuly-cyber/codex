import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir, readFile, readdir, open, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(url?: string, dir = '.data/postgres'): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
    });
    return {
      ...wrap(pool),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn(wrap(client));
          await client.query('COMMIT');
          return value;
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  let release = async () => {};
  if (dir !== 'memory://') {
    await mkdir(dir, { recursive: true });
    const lockFile = join(dir, '.evomeme.lock');
    const owner = { pid: process.pid, token: randomUUID() };
    async function claim() {
      const file = await open(lockFile, 'wx');
      try { await file.writeFile(JSON.stringify(owner)); } finally { await file.close(); }
    }
    try { await claim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery; two simultaneous restarts must not unlink
      // each other's newly acquired locks. Never remove an unfamiliar/live lock.
      const recovery = `${lockFile}.recovery`;
      await mkdir(recovery);
      try {
        const old = JSON.parse(await readFile(lockFile, 'utf8')) as { pid: number };
        if (!Number.isSafeInteger(old.pid) || old.pid <= 0) throw new Error('Unrecognized local database lock; inspect before removing it.', { cause: error });
        let alive = true;
        try { process.kill(old.pid, 0); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw e; }
        if (alive) throw new Error('Local database is already open. Reuse the API process; do not run multiple PGlite instances.', { cause: error });
        await unlink(lockFile);
        await claim();
      } finally {
        await rmdir(recovery);
      }
    }
    release = async () => {
      const current = JSON.parse(await readFile(lockFile, 'utf8')) as { token: string };
      if (current.token === owner.token) await unlink(lockFile);
    };
  }
  let db: PGlite;
  try { db = new PGlite(dir); await db.waitReady; }
  catch (e) { await release(); throw e; }
  return {
    query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows,
    transaction: fn => db.transaction(tx => fn({ query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows })),
    close: async () => { await db.close(); await release(); },
  };
}
export async function migrate(db: Database) {
  const directory = new URL('./migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d+_.*\.sql$/.test(file)).sort();
  await db.transaction(async tx => {
    // pg drivers and PGlite both accept individual statements with bind-free queries.
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.query(statement);
    }
  });
}

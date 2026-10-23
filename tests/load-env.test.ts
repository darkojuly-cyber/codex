import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadEnvironment } from '../packages/core/src/load-env.js';

it('loads Neon env files without replacing runtime secrets or logging credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evomeme-env-'));
  try {
    await writeFile(join(directory, '.env'), 'DATABASE_URL=base\nDATABASE_URL_UNPOOLED=direct\n');
    await writeFile(join(directory, '.env.local'), 'DATABASE_URL=local\n');
    const target: NodeJS.ProcessEnv = {};
    loadEnvironment(target, directory);
    expect(target).toEqual({ DATABASE_URL: 'local', DATABASE_URL_UNPOOLED: 'direct' });
    const injected: NodeJS.ProcessEnv = { DATABASE_URL: 'injected' };
    loadEnvironment(injected, directory);
    expect(injected.DATABASE_URL).toBe('injected');
    await rm(join(directory, '.env.local'));
    const legacy: NodeJS.ProcessEnv = {};
    loadEnvironment(legacy, directory);
    expect(legacy.DATABASE_URL).toBe('base');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

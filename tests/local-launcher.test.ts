import { afterAll, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { localConfig, redactOutput, projectId, projectProcesses, caddyConfiguration, sourceFingerprint, quickTunnelOrigin } from '../scripts/local-launcher-utils.js';
import { newOwner, readOwner, claimSession, releaseSession, startControl, contactSession, type LauncherStatus } from '../scripts/local-launcher-state.js';

const temporary: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'evomeme-launcher-')); temporary.push(path); return path; }
afterAll(async () => { await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true }))); });
const env = {
  DATABASE_URL: 'postgresql://user:private-password@localhost/evomeme', DISCORD_TOKEN: 'private-bot-token',
  DISCORD_GUILD_ID: '123456789012345678', DISCORD_CLIENT_ID: '223456789012345678', DISCORD_CLIENT_SECRET: 'private-client-secret',
  DISCORD_REDIRECT_URI: 'https://localhost:8443/api/auth/callback', PUBLIC_ORIGIN: 'https://localhost:8443', LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local', APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
};

it('uses the configured local origin and credentials, keeping privileged intents unchanged', () => {
  const config = localConfig('/project', { ...env, GUILD_MEMBERS_INTENT: 'false', MESSAGE_CONTENT_INTENT: 'true' });
  expect(config.port).toBe(3210); expect(config.tlsPort).toBe(8443);
  expect(config.env.APP_MODE).toBe('discord'); expect(config.env.HOST).toBe('127.0.0.1');
  expect(config.env.GUILD_MEMBERS_INTENT).toBe('false'); expect(config.env.MESSAGE_CONTENT_INTENT).toBe('true');
  expect(() => localConfig('/project', { ...env, PUBLIC_ORIGIN: 'https://example.com' })).toThrow('loopback');
  expect(() => localConfig('/project', { ...env, PORT: '8443' })).toThrow('different ports');
  expect(() => localConfig('/project', { ...env, DISCORD_REDIRECT_URI: 'https://wrong.example/callback' })).toThrow('DISCORD_REDIRECT_URI');
  expect(() => localConfig('/project', { ...env, DISCORD_TOKEN: '' })).toThrow('DISCORD_TOKEN');
  expect(() => localConfig('/project', { ...env, DATABASE_URL: 'invalid-private-password' })).not.toThrow('invalid-private-password');
});

it('opts into a public Quick Tunnel without changing local proxy, saved settings or process scope', () => {
  const original = structuredClone(env);
  const origin = 'https://friendly-example-tunnel.trycloudflare.com';
  const config = localConfig('/project', { ...env, MESSAGE_CONTENT_INTENT: 'true' }, origin);
  expect(config.origin).toBe(origin); expect(config.localOrigin).toBe('https://localhost:8443');
  expect(config.tlsPort).toBe(8443); expect(config.port).toBe(3210);
  expect(config.publicTunnel).toBe(true); expect(config.env.HOST).toBe('127.0.0.1');
  expect(config.env.PUBLIC_ORIGIN).toBe(origin);
  expect(config.env.DISCORD_REDIRECT_URI).toBe(`${origin}/api/auth/callback`);
  expect(config.env.MESSAGE_CONTENT_INTENT).toBe('true'); expect(env).toEqual(original);
  expect(caddyConfiguration(config.localOrigin, config.port)).toContain('https://localhost:8443');
  expect(localConfig('/project', env).publicTunnel).toBe(false);
});

it('rejects malformed tunnel origins instead of allowing arbitrary callback destinations', () => {
  expect(quickTunnelOrigin(' https://friendly-example.trycloudflare.com/ ')).toBe('https://friendly-example.trycloudflare.com');
  for (const value of ['http://friendly-example.trycloudflare.com','https://trycloudflare.com','https://example.com','https://127.0.0.1','https://localhost:8443','https://friendly-example.trycloudflare.com/other','https://friendly-example.trycloudflare.com?token=secret','https://user:secret@friendly-example.trycloudflare.com','https://friendly-example.trycloudflare.com:8443','https://friendly-example.trycloudflare.com.evil.test']) {
    expect(() => localConfig('/project', env, value)).toThrow();
  }
});

it('identifies only this folder’s Node services, including paths with spaces and URL encoding', () => {
  const root = 'D:\\Discord bot\\codex-evomeme-v0.1';
  const result = projectProcesses([
    { ProcessId: 1, CommandLine: 'node --require "D:\\Discord bot\\codex-evomeme-v0.1\\node_modules\\tsx\\dist\\preflight.cjs" apps/api/src/main.ts' },
    { ProcessId: 2, CommandLine: 'node --import file:///D:/Discord%20bot/codex-evomeme-v0.1/node_modules/tsx/dist/loader.mjs apps/discord-bot/src/main.ts' },
    { ProcessId: 3, CommandLine: 'node --import tsx "D:\\Discord bot\\codex-evomeme-v0.1\\scripts\\run-local-service.ts" Worker' },
    { ProcessId: 4, CommandLine: 'node D:/another-project/apps/discord-bot/src/main.ts' },
    { ProcessId: 5, CommandLine: 'node D:/Discord%20bot/codex-evomeme-v0.10/apps/discord-bot/src/main.ts' },
    { ProcessId: 6, CommandLine: null },
  ], root);
  expect(result.get('API')).toEqual([1]); expect(result.get('Bot')).toEqual([2]); expect(result.get('Worker')).toEqual([3]);
});

it('redacts tokens, URLs, escaped passwords and ANSI codes before logs are written', () => {
  const redact = redactOutput({ ...env, DATABASE_URL_UNPOOLED: 'postgresql://u:private%40password@localhost/db' });
  const text = redact(`\u001b[31m${env.DISCORD_TOKEN} ${env.DISCORD_CLIENT_SECRET} ${env.DATABASE_URL} private@password private%40password postgresql://u:unknown-secret@host/db`);
  for (const secret of ['private-bot-token','private-client-secret','private-password','private@password','private%40password','unknown-secret','\u001b']) expect(text).not.toContain(secret);
  expect(text).toContain('[REDACTED]');
});

it('generates local-only TLS proxy config without altering the user’s Caddy file', () => {
  const config = caddyConfiguration('https://localhost:8443', 3210);
  expect(config).toContain('bind 127.0.0.1 ::1'); expect(config).toContain('admin off');
  expect(config).toContain('reverse_proxy 127.0.0.1:3210'); expect(config).toContain('auto_https disable_redirects');
});

it('rebuilds when source changes, while excluding credentials, data and generated bundles', async () => {
  const root = await directory();
  for (const path of ['apps/web/src','apps/web/dist','packages/core','scripts']) await mkdir(join(root,path), { recursive: true });
  for (const file of ['package.json','package-lock.json','tsconfig.json']) await writeFile(join(root,file), '{}');
  await writeFile(join(root,'apps/web/src/index.ts'), 'initial');
  const first = await sourceFingerprint(root);
  await writeFile(join(root,'.env.local'), 'DISCORD_TOKEN=not-hashed');
  await writeFile(join(root,'apps/web/dist/bundle.js'), 'ignored');
  expect(await sourceFingerprint(root)).toBe(first);
  await writeFile(join(root,'apps/web/src/index.ts'), 'updated');
  expect(await sourceFingerprint(root)).not.toBe(first);
});

it('authenticates local control and refuses stopping another project or duplicate session', async () => {
  const path = await directory(); const id = projectId(path); const owner = newOwner(id); const stopped = vi.fn();
  const status = (): LauncherStatus => ({ application: 'EvoMeme Launcher', rootId: id, pid: owner.pid, phase: 'ready', origin: 'https://localhost:8443', services: [] });
  const server = await startControl(owner, status, stopped);
  try {
    expect(await claimSession(path, owner)).toBe(true);
    expect(await claimSession(path, { ...owner, token: 'a'.repeat(64) })).toBe(false);
    expect((await readOwner(path))?.token).toBe(owner.token);
    expect((await fetch(`http://127.0.0.1:${owner.port}/stop`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${owner.port}/status`, { headers: { 'x-evomeme-launcher': 'é'.repeat(64) } })).status).toBe(403);
    await expect(contactSession(owner, projectId('/another-project'), 'stop')).rejects.toThrow('another project');
    expect(stopped).not.toHaveBeenCalled();
    expect((await contactSession(owner, id, 'status')).phase).toBe('ready');
    await contactSession(owner, id, 'stop');
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    await releaseSession(path, { ...owner, token: 'b'.repeat(64) });
    expect(await readOwner(path)).not.toBeNull();
    await releaseSession(path, owner); expect(await readOwner(path)).toBeNull();
  } finally { server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('recovers only an absent process’s stale launcher lock and never touches database locks', async () => {
  const path = await directory(); const owner = { ...newOwner(projectId(path)), port: 3456 };
  await writeFile(join(path,'owner.json'), JSON.stringify({ ...owner, pid: 2147483647 }));
  await writeFile(join(path,'.evomeme.lock'), 'database lock remains untouched');
  expect(await claimSession(path, owner)).toBe(true);
  expect(await readFile(join(path,'.evomeme.lock'), 'utf8')).toBe('database lock remains untouched');
  await releaseSession(path, owner);
});

it('recovers state after a reboot or verified PID reuse without sending any termination signal', async () => {
  const path = await directory();
  const owner = { ...newOwner(projectId(path)), port: 3456, bootId: 'new-boot' };
  await writeFile(join(path,'owner.json'), JSON.stringify({ ...owner, bootId: 'old-boot', token: 'a'.repeat(64) }));
  const sameBootCheck = vi.fn(async () => true);
  expect(await claimSession(path, owner, sameBootCheck)).toBe(true);
  expect(sameBootCheck).not.toHaveBeenCalled();
  await releaseSession(path, owner);
  await writeFile(join(path,'owner.json'), JSON.stringify({ ...owner, token: 'b'.repeat(64) }));
  const reusedPid = vi.fn(async () => false);
  expect(await claimSession(path, owner, reusedPid)).toBe(true);
  expect(reusedPid).toHaveBeenCalledTimes(1);
  expect(process.pid).toBe(owner.pid); // The old metadata deliberately used this live process's PID.
  await releaseSession(path, owner);
});

it('starts the real API in an isolated local database and stops gracefully over IPC without leaving an orphan or DB lock', async () => {
  const data = await directory();
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const child = spawn(process.execPath, ['--import','tsx',join(root,'scripts/run-local-service.ts'),'API'], {
    cwd: root, env: { ...process.env, APP_MODE: 'mock', HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: 'http://localhost:3000', DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', DATA_DIR: data }, stdio: ['ignore','pipe','pipe','ipc'],
  });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API did not start.')), 20000);
      const reader = createInterface({ input: child.stdout! });
      reader.on('line', line => { try { const value = JSON.parse(line) as { msg?: string }; const match = value.msg?.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } } catch { /* Readiness must be explicit. */ } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('API exited before readiness.')); });
    });
    const response = await fetch(`${address}/api/health`); const health = await response.json();
    expect(health.status).toBe('ok'); expect(health.localProjectId).toBe(projectId(root));
    child.send({ type: 'evomeme.stop' });
    expect(await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 10000))])).toBe(0);
    await expect(readFile(join(data,'postgres','.evomeme.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

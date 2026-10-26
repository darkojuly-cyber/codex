import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

export type ServiceRole = 'API' | 'Bot' | 'Worker' | 'Caddy';
export type ProcessInfo = { ProcessId: number; CommandLine: string | null; CreatedAt?: string };
export function projectId(root: string) { return createHash('sha256').update(resolve(root).toLowerCase()).digest('hex'); }
export function projectProcesses(processes: ProcessInfo[], root: string): Map<ServiceRole, number[]> {
  const groups = new Map<ServiceRole, number[]>();
  const normalize = (text: string) => {
    try { text = decodeURIComponent(text); } catch { /* Native paths can contain literal %. */ }
    return text.replaceAll('\\', '/').toLowerCase();
  };
  const prefix = `${normalize(root).replace(/\/$/, '')}/`;
  for (const process of processes) {
    const command = normalize(process.CommandLine ?? '');
    if (!command.includes(prefix)) continue;
    const patterns: [ServiceRole, RegExp][] = [
      ['API', /(?:^|[\s"/])apps\/api\/src\/main\.ts(?:[\s"']|$)/],
      ['Bot', /(?:^|[\s"/])apps\/discord-bot\/src\/main\.ts(?:[\s"']|$)/],
      ['Worker', /(?:^|[\s"/])apps\/worker\/src\/main\.ts(?:[\s"']|$)/],
      ['API', /run-local-service\.ts["']?\s+["']?api(?:[\s"']|$)/],
      ['Bot', /run-local-service\.ts["']?\s+["']?bot(?:[\s"']|$)/],
      ['Worker', /run-local-service\.ts["']?\s+["']?worker(?:[\s"']|$)/],
    ];
    for (const [role, pattern] of patterns) if (pattern.test(command)) {
      const ids = groups.get(role) ?? [];
      if (!ids.includes(process.ProcessId)) ids.push(process.ProcessId);
      groups.set(role, ids);
    }
  }
  return groups;
}

export function localConfig(root: string, input: NodeJS.ProcessEnv) {
  const env = Object.fromEntries(Object.entries(input).filter((entry): entry is [string,string] => !!entry[1]));
  const required = ['DATABASE_URL','DISCORD_TOKEN','DISCORD_GUILD_ID','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_REDIRECT_URI'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Missing settings in .env.local/.env: ${missing.join(', ')}`);
  const port = Number(env.PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid local TCP port.');
  let origin: URL;
  try { origin = new URL(env.PUBLIC_ORIGIN ?? 'https://localhost:8443'); }
  catch { throw new Error('PUBLIC_ORIGIN must be a local HTTPS origin.'); }
  if (origin.protocol !== 'https:' || !['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('This launcher requires a loopback HTTPS PUBLIC_ORIGIN, such as https://localhost:8443.');
  const tlsPort = Number(origin.port || 443);
  if (port === tlsPort) throw new Error('API and HTTPS must use different ports.');
  if (env.DISCORD_REDIRECT_URI !== `${origin.origin}/api/auth/callback`) throw new Error(`DISCORD_REDIRECT_URI must be ${origin.origin}/api/auth/callback`);
  let database: URL;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('This launcher requires external PostgreSQL; it does not start multiple local PGlite processes.');
  if (!/^\d{17,20}$/.test(env.DISCORD_GUILD_ID)) throw new Error('DISCORD_GUILD_ID must be a server ID.');
  const childEnv: NodeJS.ProcessEnv = { ...input, APP_MODE: 'discord', HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin.origin };
  return {
    root, port, tlsPort, origin: origin.origin,
    caddyExe: env.EVOMEME_CADDY_EXE ?? join(env.LOCALAPPDATA ?? '', 'EvoMemeTools', 'caddy.exe'),
    caddyFile: env.EVOMEME_CADDYFILE,
    rootCertificate: env.EVOMEME_CADDY_ROOT_CERT ?? join(env.APPDATA ?? '', 'Caddy', 'pki', 'authorities', 'local', 'root.crt'),
    env: childEnv,
  };
}

export function redactOutput(input: NodeJS.ProcessEnv): (text: string) => string {
  const values = new Set<string>();
  for (const key of ['DISCORD_TOKEN','DISCORD_CLIENT_SECRET','DATABASE_URL','DATABASE_URL_UNPOOLED']) if (input[key]) values.add(input[key]!);
  for (const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED']) {
    try {
      const password = new URL(input[key] ?? '').password;
      if (password) { values.add(password); values.add(decodeURIComponent(password)); }
    } catch { /* Never include invalid credential values in diagnostics. */ }
  }
  const secrets = [...values].filter(Boolean).sort((a,b) => b.length - a.length);
  return text => {
    text = stripVTControlCharacters(text);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text.replace(/(postgres(?:ql)?:\/\/[^\s:/@]+:)[^\s@]+@/gi, '$1[REDACTED]@');
  };
}

export function caddyConfiguration(origin: string, apiPort: number) {
  return `{\n    admin off\n    auto_https disable_redirects\n}\n${origin} {\n    bind 127.0.0.1 ::1\n    tls internal\n    reverse_proxy 127.0.0.1:${apiPort}\n}\n`;
}

export async function sourceFingerprint(root: string) {
  const hash = createHash('sha256');
  async function visit(relative: string) {
    const absolute = join(root, relative);
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') { hash.update(relative).update(await readFile(absolute)); return; } throw error; }
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules','dist','.git','.data'].includes(entry.name) || entry.name.startsWith('.env')) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:tsx?|css|json|html|mjs)$/.test(entry.name)) hash.update(path).update(await readFile(join(root,path)));
    }
  }
  for (const relative of ['apps','packages','scripts','package.json','package-lock.json','tsconfig.json']) await visit(relative);
  return hash.digest('hex');
}

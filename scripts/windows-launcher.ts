import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { existsSync, appendFileSync, statSync, renameSync, rmSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../packages/core/src/load-env.js';
import { caddyConfiguration, localConfig, projectId, projectProcesses, redactOutput, sourceFingerprint, type ServiceRole, type ProcessInfo } from './local-launcher-utils.js';
import { claimSession, contactSession, isProcessAlive, newOwner, readOwner, releaseSession, startControl, type ServiceStatus, type LauncherStatus, type SessionOwner } from './local-launcher-state.js';
import { createDesktopShortcut } from './windows-shortcut.js';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = join(root, '.data', 'launcher');
const id = projectId(root);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function browser(origin: string) {
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe');
  const child = spawn(executable, ['url.dll,FileProtocolHandler', origin], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`Open ${origin} in your browser.`)); child.unref();
}
async function openPort(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const end = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => end(true)); socket.once('error', () => end(false)); socket.setTimeout(1000, () => end(false));
  });
}
async function health(url: string, certificate?: string) {
  if (url.startsWith('http:')) {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!response.ok) throw new Error('API health is not ready.');
    return response.json() as Promise<Record<string, unknown>>;
  }
  let ca: string[] = [...rootCertificates];
  if (certificate && existsSync(certificate)) ca = [...ca, await readFile(certificate, 'utf8')];
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = request(url, { ca, rejectUnauthorized: true }, response => {
      let body = '';
      response.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 16384) req.destroy(new Error('Unexpected HTTPS response.')); });
      response.on('end', () => { try { if (response.statusCode !== 200) throw new Error('HTTPS proxy is not ready.'); resolve(JSON.parse(body)); } catch { reject(new Error('HTTPS health is not ready.')); } });
    });
    req.on('error', reject); req.setTimeout(2500, () => req.destroy(new Error('HTTPS health timed out.'))); req.end();
  });
}
function isOurHealth(value: Record<string, unknown>) {
  return value.status === 'ok' && value.mode === 'DISCORD' && value.database === 'PostgreSQL' && value.localProjectId === id;
}
async function processes() {
  const command = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [pscustomobject]@{ bootId = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); processes = @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine,@{Name='CreatedAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}}) } | ConvertTo-Json -Depth 4 -Compress";
  try {
    const { stdout } = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',command], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { bootId: string; processes: ProcessInfo[] };
    if (!parsed.bootId || !Array.isArray(parsed.processes)) throw new Error('Incomplete process inspection.');
    return parsed;
  } catch { throw new Error('Cannot inspect existing project processes. Close old Bot/Worker windows and retry; no processes were stopped.'); }
}
async function ownerAlive(owner: SessionOwner) {
  if (!isProcessAlive(owner.pid)) return false;
  try { await contactSession(owner, owner.rootId, 'status'); return true; } catch { /* Check identity before treating a reused PID as this launcher. */ }
  if (!owner.processStart) return true;
  try {
    const script = "$ErrorActionPreference = 'Stop'; $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:EVOMEME_PROBE_PID); if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }";
    const { stdout } = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',script], { windowsHide: true, timeout: 10000, env: { ...process.env, EVOMEME_PROBE_PID: String(owner.pid) } });
    return stdout.trim() === owner.processStart;
  } catch { return true; }
}

async function start() {
  const env = { ...process.env }; loadEnvironment(env, root);
  const config = localConfig(root, env);
  const owner = newOwner(id);
  const inspection = await processes();
  owner.bootId = inspection.bootId;
  owner.processStart = inspection.processes.find(item => item.ProcessId === process.pid)?.CreatedAt;
  if (!owner.processStart) throw new Error('Cannot identify this Node process; no services were started.');
  const services: ServiceStatus[] = [];
  const children = new Map<string, ChildProcess>();
  const sanitize = redactOutput(config.env);
  const logs = join(stateDirectory, 'logs');
  await mkdir(logs, { recursive: true });
  const log = (role: string, message: string) => {
    const clean = sanitize(message);
    console.log(`[${role}] ${clean}`);
    const file = join(logs, `${role.toLowerCase()}.log`);
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) {
      rmSync(`${file}.previous`, { force: true }); renameSync(file, `${file}.previous`);
    }
    appendFileSync(file, `${new Date().toISOString()} ${clean}\n`, { mode: 0o600 });
  };
  let phase = 'starting';
  let shutdownPromise: Promise<void> | undefined;
  let claimed = false;
  const snapshot = (): LauncherStatus => ({ application: 'EvoMeme Launcher', rootId: id, pid: process.pid, phase, origin: config.origin, services });
  const control = await startControl(owner, snapshot, () => { void shutdown(0); });
  async function shutdown(code: number) {
    if (shutdownPromise) return shutdownPromise;
    phase = 'stopping';
    shutdownPromise = (async () => {
      log('Launcher', 'Stopping only services started by this session...');
      await Promise.allSettled([...children.entries()].reverse().map(async ([role, child]) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.connected) { try { child.send({ type: 'evomeme.stop' }); } catch { /* Fall back to this owned process handle. */ } }
        else child.kill('SIGTERM');
        const deadline = Date.now() + 12000;
        while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        log(role, 'Stopped.');
      }));
      for (const service of services) if (service.owned) service.status = 'stopped';
      control.closeIdleConnections(); await new Promise<void>(resolve => control.close(() => resolve()));
      if (claimed) await releaseSession(stateDirectory, owner);
      process.exitCode = code;
    })();
    return shutdownPromise;
  }
  function ensureStarting() { if (phase === 'stopping') throw new Error('Startup was stopped.'); }
  function launch(role: string, executable: string, args: string[], childEnv: NodeJS.ProcessEnv, ipc: boolean) {
    ensureStarting();
    const child = spawn(executable, args, { cwd: root, env: childEnv, windowsHide: true, stdio: ipc ? ['ignore','pipe','pipe','ipc'] : ['ignore','pipe','pipe'] });
    children.set(role, child);
    const service = { role, owned: true, status: 'starting', pid: child.pid }; services.push(service);
    let ready = false;
    child.once('error', () => { service.status = 'failed'; });
    for (const stream of [child.stdout, child.stderr]) if (stream) {
      const reader = createInterface({ input: stream });
      reader.on('line', line => {
        log(role, line);
        try { const data = JSON.parse(line) as { event?: string }; if (data.event === (role === 'Bot' ? 'bot.ready' : 'worker.ready')) { ready = true; service.status = 'ready'; } } catch { /* Ordinary logs are not readiness signals. */ }
      });
    }
    child.once('exit', (code, signal) => {
      if (role === 'Build') return;
      service.status = 'stopped';
      if (phase !== 'stopping') {
        log(role, `Exited unexpectedly (${signal ?? code ?? 'unknown'}). Check this service's log.`);
        void shutdown(1);
      }
    });
    return { child, service, ready: () => ready };
  }
  async function waitFor(check: () => Promise<boolean>, label: string, alive?: ChildProcess, timeout = 90000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      ensureStarting();
      if (alive && (alive.pid === undefined || alive.exitCode !== null || alive.signalCode !== null)) throw new Error(`${label} exited before readiness.`);
      try { if (await check()) return; } catch { /* Retry a starting service, preserving TLS checks. */ }
      await delay(500);
    }
    throw new Error(`${label} did not become ready. Check .data/launcher/logs and the configured certificates/intents.`);
  }
  try {
    claimed = await claimSession(stateDirectory, owner, ownerAlive);
    if (!claimed) {
      const existing = await readOwner(stateDirectory);
      if (!existing) throw new Error('A launcher is starting; retry shortly.');
      const status = await contactSession(existing, id, 'status');
      console.log(`EvoMeme is already ${status.phase}. No duplicate services started.`);
      control.closeIdleConnections(); await new Promise<void>(resolve => control.close(() => resolve()));
      if (status.phase === 'ready') browser(status.origin);
      return;
    }
    for (const signal of ['SIGINT','SIGTERM','SIGHUP'] as const) process.once(signal, () => { void shutdown(0); });
    for (const file of ['node_modules/typescript/bin/tsc','node_modules/vite/bin/vite.js','node_modules/tsx/dist/loader.mjs']) if (!existsSync(join(root,file))) throw new Error('Dependencies are missing. Run npm ci once in the project folder.');
    if (!existsSync(config.caddyExe)) throw new Error('Caddy was not found. Install it in %LOCALAPPDATA%\\EvoMemeTools, or set EVOMEME_CADDY_EXE in .env.local.');
    log('Launcher', `Member events: ${config.env.GUILD_MEMBERS_INTENT === 'true' ? 'ON' : 'OFF'}; chat scoring input: ${config.env.MESSAGE_CONTENT_INTENT === 'true' ? 'ON' : 'OFF'} (saved configuration).`);
    const running = projectProcesses(inspection.processes, root);
    for (const role of ['Bot','Worker'] as ServiceRole[]) if (running.get(role)?.length) throw new Error(`An old ${role} from this project is still running. Stop that old window with Ctrl+C once, then use Start.cmd. Other Node processes were left alone.`);
    const marker = join(stateDirectory, 'frontend.sha256');
    const fingerprint = await sourceFingerprint(root);
    const saved = existsSync(marker) ? await readFile(marker, 'utf8') : '';
    if (!existsSync(join(root,'apps/admin-console/dist/index.html')) || saved !== fingerprint) {
      log('Build', 'Source changed: checking TypeScript and building the console...');
      for (const args of [[join(root,'node_modules/typescript/bin/tsc'),'--noEmit'], [join(root,'node_modules/vite/bin/vite.js'),'build','--config','apps/admin-console/vite.config.ts']]) {
        const { child } = launch('Build', process.execPath, args, config.env, false);
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
        if (code !== 0) throw new Error('Build failed; services were not started. Read the Build log.');
        children.delete('Build'); services.splice(services.findIndex(service => service.role === 'Build'), 1);
      }
      await writeFile(marker, fingerprint);
    }
    const apiUrl = `http://127.0.0.1:${config.port}/api/health`;
    if (await openPort(config.port)) {
      if (!isOurHealth(await health(apiUrl))) throw new Error(`Port ${config.port} is occupied by an incompatible API. Stop only this project's old API window, or choose a free PORT.`);
      services.push({ role: 'API', owned: false, status: 'ready' }); log('API', 'Reusing the API already running for this folder.');
    } else {
      const { child, service } = launch('API', process.execPath, ['--import','tsx',join(root,'scripts/run-local-service.ts'),'API'], { ...config.env, DISCORD_WRITES_ENABLED: 'false' }, true);
      await waitFor(async () => isOurHealth(await health(apiUrl)), 'API', child); service.status = 'ready';
    }
    const httpsUrl = `${config.origin}/api/health`;
    if (await openPort(config.tlsPort)) {
      if (!isOurHealth(await health(httpsUrl, config.rootCertificate))) throw new Error(`HTTPS port ${config.tlsPort} does not lead to this project's API.`);
      services.push({ role: 'Caddy', owned: false, status: 'ready' }); log('Caddy', 'Reusing the existing trusted HTTPS proxy.');
    } else {
      const file = config.caddyFile ?? join(stateDirectory, 'Caddyfile');
      if (!config.caddyFile) await writeFile(file, caddyConfiguration(config.origin, config.port));
      const { child, service } = launch('Caddy', config.caddyExe, ['run','--config',file,'--adapter','caddyfile'], config.env, false);
      await waitFor(async () => isOurHealth(await health(httpsUrl, config.rootCertificate)), 'Caddy HTTPS', child); service.status = 'ready';
    }
    const latestProcesses = projectProcesses((await processes()).processes, root);
    for (const role of ['Bot','Worker'] as const) if (latestProcesses.get(role)?.length) throw new Error(`A separate ${role} was started during setup. Stop its old window and retry.`);
    for (const role of ['Bot','Worker'] as const) {
      const launched = launch(role, process.execPath, ['--import','tsx',join(root,'scripts/run-local-service.ts'),role], { ...config.env, DISCORD_WRITES_ENABLED: 'true' }, true);
      await waitFor(async () => launched.ready(), role, launched.child);
    }
    ensureStarting(); phase = 'ready';
    log('Launcher', `READY - ${config.origin}`);
    log('Launcher', 'Keep this one window open (you can minimize it). Use Stop.cmd to stop the managed services.');
    browser(config.origin);
  } catch (error) {
    log('Launcher', error instanceof Error ? error.message : 'Startup failed.');
    await shutdown(phase === 'stopping' ? 0 : 1);
  }
}

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === '--help') { console.log('Windows: Start.cmd starts the console, API, Bot and Worker; Stop.cmd stops owned services; Status.cmd shows status; CreateShortcut.cmd adds a Mimo desktop icon and Ctrl+Alt+M hotkey.'); return; }
  if (process.platform !== 'win32') throw new Error('Use this launcher on your Windows computer. The cloud environment continues to use npm run dev / npm run api.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('Node.js 22.16 or later is required.');
  if (command === 'shortcut') { await createDesktopShortcut(root, process.argv[3]); return; }
  if (command === 'start') { await start(); return; }
  if (!['stop','status'].includes(command)) throw new Error('Use Start.cmd, Stop.cmd or Status.cmd.');
  const owner = await readOwner(stateDirectory);
  if (!owner) { console.log('No one-click session is running. Manually started services are not controlled here.'); return; }
  const status = await contactSession(owner, id, command as 'status' | 'stop');
  if (command === 'status') {
    console.log(`EvoMeme: ${status.phase} - ${status.origin}`);
    for (const service of status.services) console.log(`${service.role}: ${service.status} (${service.owned ? 'managed here' : 'running in another window'})`);
    return;
  }
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) { if ((await readOwner(stateDirectory))?.token !== owner.token) { console.log('Managed services stopped. Reused external services were left running.'); return; } await delay(200); }
  throw new Error('Stop is taking longer than expected. Check the control window; no unrelated processes were stopped.');
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : 'Launcher failed.'); process.exitCode = 1; });
}

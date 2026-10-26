import { randomBytes, timingSafeEqual } from 'node:crypto';
import { open, readFile, mkdir, rmdir, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

export type SessionOwner = { pid: number; port: number; rootId: string; token: string; bootId?: string; processStart?: string };
export type ServiceStatus = { role: string; owned: boolean; status: string; pid?: number };
export type LauncherStatus = { application: 'EvoMeme Launcher'; rootId: string; pid: number; phase: string; origin: string; services: ServiceStatus[] };
export function newOwner(rootId: string): SessionOwner { return { pid: process.pid, port: 0, rootId, token: randomBytes(32).toString('hex') }; }
export function isProcessAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
export async function readOwner(directory: string): Promise<SessionOwner | null> {
  try {
    const value = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')) as SessionOwner;
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.rootId) || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('Invalid launcher state; do not remove database files.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Launcher state is incomplete. Retry shortly, or inspect only .data/launcher/owner.json.', { cause: error });
  }
}
export async function claimSession(directory: string, owner: SessionOwner, verifyAlive: (old: SessionOwner) => Promise<boolean> = async old => isProcessAlive(old.pid)): Promise<boolean> {
  await mkdir(directory, { recursive: true });
  const create = async () => {
    const file = await open(join(directory, 'owner.json'), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(owner)); } finally { await file.close(); }
  };
  try { await create(); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const recovery = join(directory, 'recovery');
  try { await mkdir(recovery); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  try {
    const old = await readOwner(directory);
    const rebooted = old?.bootId && owner.bootId && old.bootId !== owner.bootId;
    if (old && !rebooted && await verifyAlive(old)) return false;
    if (old) await unlink(join(directory, 'owner.json'));
    try { await create(); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  } finally { await rmdir(recovery); }
}
export async function releaseSession(directory: string, owner: SessionOwner) {
  const current = await readOwner(directory);
  if (current?.token === owner.token) await unlink(join(directory, 'owner.json'));
}
export async function startControl(owner: SessionOwner, status: () => LauncherStatus, stop: () => void): Promise<Server> {
  const server = createServer((request, response) => {
    const token = request.headers['x-evomeme-launcher'];
    const matches = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(owner.token));
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    if (!matches) { response.writeHead(403).end('{"error":"Forbidden"}'); return; }
    if (request.url === '/status' && request.method === 'GET') { response.end(JSON.stringify(status())); return; }
    if (request.url === '/stop' && request.method === 'POST') { response.end('{"stopping":true}'); setImmediate(stop); return; }
    response.writeHead(404).end('{"error":"Not found"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') { reject(new Error('Cannot start local control.')); return; } owner.port = address.port; resolve(); });
  });
  return server;
}
export async function contactSession(owner: SessionOwner, rootId: string, action: 'status' | 'stop') {
  if (owner.rootId !== rootId) throw new Error('This session belongs to another project folder.');
  const headers = { 'x-evomeme-launcher': owner.token };
  const response = await fetch(`http://127.0.0.1:${owner.port}/status`, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Cannot verify the existing one-click session.');
  const status = await response.json() as LauncherStatus;
  if (status.application !== 'EvoMeme Launcher' || status.rootId !== rootId || status.pid !== owner.pid) throw new Error('The control port is not owned by this launcher.');
  if (action === 'stop') {
    const stopped = await fetch(`http://127.0.0.1:${owner.port}/stop`, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!stopped.ok) throw new Error('Stop request was not accepted.');
  }
  return status;
}

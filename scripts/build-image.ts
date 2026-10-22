import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { access } from 'node:fs/promises';
import 'dotenv/config';

// Preserve the platform's configured egress proxy and CA verification. Some
// BuildKit networks cannot resolve host-only proxy DNS; resolve using the host's
// trusted resolver and pass that mapping, never an alternate public DNS service.
async function build() {
  const tag = process.argv[2] ?? 'evomeme:local';
  if (!/^[a-z0-9][a-z0-9/.:_-]*$/.test(tag)) throw new Error('Invalid image tag');
  const args = ['build', '--progress=plain'];
  const hosts = new Set<string>();
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
    if (!process.env[name]) continue;
    args.push('--build-arg', name);
    if (!name.toLowerCase().includes('no_proxy')) hosts.add(new URL(process.env[name]!).hostname);
  }
  for (const host of hosts) args.push('--add-host', `${host}:${(await lookup(host, { family: 4 })).address}`);
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  if (ca) { await access(ca); args.push('--secret', `id=build_ca,src=${ca}`); }
  args.push('-t', tag, '.');
  const child = spawn('docker', args, { stdio: 'inherit', env: process.env });
  child.on('error', () => { console.error('Docker executable unavailable.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
void build().catch(() => { console.error('Image build preflight failed. Check Docker access, image tag, configured proxy DNS and the existing trusted CA file. No verification was disabled.'); process.exitCode = 1; });

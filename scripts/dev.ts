import { spawn } from 'node:child_process';
const commands = [ ['tsx', 'apps/api/src/main.ts'], ['vite', '--config', 'apps/admin-console/vite.config.ts'] ];
const children = commands.map(args => spawn(process.execPath, [args[0] === 'tsx' ? 'node_modules/tsx/dist/cli.mjs' : 'node_modules/vite/bin/vite.js', ...args.slice(1)], { stdio: 'inherit', env: process.env }));
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) child.on('exit', code => stop(code ?? 0));

// Run one Node service directly (no npm/tsx process tree) and stop it over IPC.
export {};
const entries: Record<string, string> = {
  API: '../apps/api/src/main.js', Bot: '../apps/discord-bot/src/main.js', Worker: '../apps/worker/src/main.js',
};
const role = process.argv[2];
if (!entries[role]) throw new Error('Unknown local service.');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
  const deliver = () => {
    if (!process.listenerCount('SIGTERM')) return false;
    process.emit('SIGTERM', 'SIGTERM');
    if (process.connected) process.disconnect?.();
    return true;
  };
  if (!deliver()) {
    const timer = setInterval(() => { if (deliver()) clearInterval(timer); }, 50);
    timer.unref();
  }
}
process.on('message', message => { if ((message as { type?: string } | null)?.type === 'evomeme.stop') stop(); });
process.once('disconnect', stop);
try {
  await import(entries[role]);
  if (process.exitCode) process.exit(Number(process.exitCode));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Service startup failed.');
  process.exit(1);
}

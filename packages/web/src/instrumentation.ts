// Once per server process (Next's instrumentation hook): the toolchain check (the `wye` command installed when missing,
// which agents and tools this machine has — lib/toolchain), the tunnels to remote agents (lib/remote), then the hooks clock (decision:ea.time-based-hooks) — a tick
// every 60 s over every product, one at startup for the slots missed while the app was down. Node runtime only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureToolchain } = await import('./lib/toolchain');
  await ensureToolchain().catch(e => console.error(`wye: toolchain check failed: ${(e as Error).message}`));
  // the tunnels to remote agents that were on when the app stopped (lib/remote)
  const { startRemotes } = await import('./lib/remote');
  await startRemotes().catch(e => console.error(`wye: remote tunnels: ${(e as Error).message}`));
  // the memory cap (lib/memory-guard): past WYE_MAX_MEMORY_GB the server ends its agents and restarts
  const { startMemoryGuard } = await import('./lib/memory-guard');
  startMemoryGuard();
  // live documents for the page editors, over the websocket server.js hands on (plan:collaboration)
  const { startCollab } = await import('./lib/collab/collab-server');
  startCollab();
  // a production server restarts when its build is replaced under it (lib/build-watch)
  if (process.env.NODE_ENV === 'production') { const { startBuildWatch } = await import('./lib/build-watch'); startBuildWatch(); }
  if (process.env.WF_HOOKS === '0') return;
  const { startClock } = await import('./lib/hooks-clock');
  startClock();
}

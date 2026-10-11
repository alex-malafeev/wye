// The memory cap (decision:waterfall.app-restarts-over-memory-cap): the server watches its own size and, past the
// cap, ends the agents it hosts and exits with the code its parent restarts on — `next dev` restarts its worker on
// 77 (RESTART_EXIT_CODE in next/dist/server/lib/utils), and `wye app` does the same for `next start`. A session
// whose process was ended this way is left `done` with its agent session id; Resume continues it.
type Usage = Pick<NodeJS.MemoryUsage, 'rss' | 'heapUsed' | 'external'>;
export const RESTART_EXIT_CODE = 77;
export const CAP_GB = (() => { const n = Number(process.env.WYE_MAX_MEMORY_GB ?? '40'); return Number.isFinite(n) && n > 0 ? n : 40; })();

// What the process holds: the resident set, or the heap when the OS has compressed or swapped most of it out
// (macOS reports a small rss for a process whose heap is many GB).
export function usedBytes(u: Usage): number { return Math.max(u.rss, u.heapUsed + u.external); }
export function usedGb(u: Usage): number { return Math.round(usedBytes(u) / 2 ** 30 * 10) / 10; }
export function overCap(u: Usage, capGb = CAP_GB): boolean { return usedBytes(u) >= capGb * 2 ** 30; }

type Opts = { everyMs?: number; capGb?: number; usage?: () => Usage; exit?: (code: number) => void; stopAgents?: (reason: string) => Promise<void> };
const g = globalThis as unknown as { __wfMemoryGuard?: ReturnType<typeof setInterval> };

// Once per server process: a check every 30 s; one warning at half the cap, then the restart at the cap.
export function startMemoryGuard(opts: Opts = {}): () => void {
  const every = opts.everyMs ?? 30_000; const cap = opts.capGb ?? CAP_GB;
  const usage = opts.usage ?? (() => process.memoryUsage());
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const stopAgents = opts.stopAgents ?? (async (reason: string) => { const { stopAllForRestart } = await import('./agent-host'); await stopAllForRestart(reason); });
  if (g.__wfMemoryGuard) clearInterval(g.__wfMemoryGuard);
  let warned = false; let restarting = false;
  const check = () => {
    const u = usage(); const gb = usedGb(u);
    if (!warned && usedBytes(u) >= cap * 2 ** 29) { warned = true; console.warn(`wye: the app uses ${gb} GB — it restarts at ${cap} GB (WYE_MAX_MEMORY_GB)`); }
    if (restarting || !overCap(u, cap)) return;
    restarting = true;
    const reason = `the app used ${gb} GB, over its cap of ${cap} GB (WYE_MAX_MEMORY_GB), and restarts — Resume continues with the same context`;
    console.error(`wye: ${reason}`);
    stopAgents(reason).catch(() => {}).finally(() => setTimeout(() => exit(RESTART_EXIT_CODE), 2000));
  };
  const t = setInterval(check, every); t.unref?.();
  g.__wfMemoryGuard = t;
  return () => { clearInterval(t); if (g.__wfMemoryGuard === t) g.__wfMemoryGuard = undefined; };
}

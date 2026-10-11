// A production server whose build is replaced under it (`next build` while `next start` runs — `npm run desktop:prod`
// beside a running `wye app`) keeps the old build's manifests and serves the new build's files wrong: the stylesheets
// come back as pages and the app shows unstyled. It notices the new BUILD_ID and restarts the way the memory cap does
// (lib/memory-guard): its agents ended, exit 77, which `wye app` and the desktop app start again on.
import fs from 'node:fs';
import path from 'node:path';
import { RESTART_EXIT_CODE } from './memory-guard';

type Opts = { everyMs?: number; file?: string; read?: (file: string) => string | null; exit?: (code: number) => void; stopAgents?: (reason: string) => Promise<void> };
const g = globalThis as unknown as { __wfBuildWatch?: ReturnType<typeof setInterval> };
const readId = (file: string) => { try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; } };

// Once per production server process: the BUILD_ID it started with, checked every 5 s; a missing file (a build under
// way) waits, a different one restarts the server, once.
export function startBuildWatch(opts: Opts = {}): () => void {
  const file = opts.file ?? path.join(process.cwd(), '.next', 'BUILD_ID');
  const read = opts.read ?? readId;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const stopAgents = opts.stopAgents ?? (async (reason: string) => { const { stopAllForRestart } = await import('./agent-host'); await stopAllForRestart(reason); });
  if (g.__wfBuildWatch) clearInterval(g.__wfBuildWatch);
  const started = read(file);
  let restarting = false;
  const check = () => {
    const now = read(file);
    if (restarting || !started || !now || now === started) return;
    restarting = true;
    const reason = 'the app was rebuilt and restarts on the new build — Resume continues with the same context';
    console.error(`wye: ${reason}`);
    stopAgents(reason).catch(() => {}).finally(() => setTimeout(() => exit(RESTART_EXIT_CODE), 500));
  };
  const t = setInterval(check, opts.everyMs ?? 5_000); t.unref?.();
  g.__wfBuildWatch = t;
  return () => { clearInterval(t); if (g.__wfBuildWatch === t) g.__wfBuildWatch = undefined; };
}

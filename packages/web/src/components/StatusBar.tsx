'use client';
import { useEffect, useState } from 'react';

// The bar at the bottom of every page (decision:waterfall.status-bar-memory-and-limits): the server's memory against
// its cap, and each agent's plan windows as Claude Code's /usage and Codex's /status show them — the 5-hour and the
// weekly window, a per-model one when the plan has it — with the time to the next reset. Polled every minute; the
// server fetches the vendors at most once every few minutes for every tab together (lib/usage).
type Window = { label: string; percent: number; resetsAt?: string };
type Agent = { agent: 'claude' | 'codex'; plan?: string; windows: Window[]; error?: string; at: string };
type Status = { memory: { used: number; rss: number; heapUsed: number; capGb: number; pid: number; uptime: number }; agents: Agent[] };

const gb = (b: number) => b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.round(b / 2 ** 20)} MB`;
// "in 2h 58m" / "in 4d 20h" — nothing when the reset has no time or is past
export function untilReset(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''; const ms = Date.parse(iso) - now; if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.round(ms / 60000); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24); return `${d}d ${h % 24}h`;
}
const NAMES = { claude: 'Claude', codex: 'Codex' };
const tone = (p: number) => p >= 90 ? 'bad' : p >= 70 ? 'warn' : '';

export function StatusBar() {
  const [s, setS] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => { try { const r = await fetch('/api/usage'); if (r.ok && alive) setS(await r.json()); } catch { /* the bar keeps what it has */ } if (alive) timer = setTimeout(load, 60_000); };
    void load();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; if (timer) clearTimeout(timer); clearInterval(tick); };
  }, []);
  if (!s) return <div className="statusbar" />;
  const mem = s.memory; const pct = Math.round(mem.used / (mem.capGb * 2 ** 30) * 100);
  return (
    <div className="statusbar">
      <span className={`sb-item ${tone(pct)}`} title={`heap ${gb(mem.heapUsed)} · resident ${gb(mem.rss)} · the app restarts past ${mem.capGb} GB (WYE_MAX_MEMORY_GB) · pid ${mem.pid}`}>
        <span className="sb-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>{gb(mem.used)} <span className="muted">of {mem.capGb} GB</span>
      </span>
      {s.agents.map(a => (
        <span key={a.agent} className="sb-agent" title={a.error ? `${NAMES[a.agent]}: ${a.error}` : `${NAMES[a.agent]}${a.plan ? ` · ${a.plan}` : ''} — what the plan's windows have used; resets counted from now`}>
          <b>{NAMES[a.agent]}</b>
          {a.error ? <span className="muted">{a.error}</span> : a.windows.length === 0 ? <span className="muted">no limits</span> : a.windows.map(w => {
            const left = untilReset(w.resetsAt, now);
            return <span key={w.label} className={`sb-item ${tone(w.percent)}`}><span className="sb-bar"><i style={{ width: `${Math.min(100, w.percent)}%` }} /></span>{w.percent}% <span className="muted">{w.label}{left ? ` · ${left}` : ''}</span></span>;
          })}
        </span>
      ))}
    </div>
  );
}

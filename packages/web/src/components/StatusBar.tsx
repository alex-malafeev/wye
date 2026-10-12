'use client';
import { useEffect, useRef, useState } from 'react';
import { CacheItem } from './CacheItem';

// The bar at the bottom of every page (decision:waterfall.status-bar-memory-and-limits): the server's memory against
// its cap, and each agent's plan windows as Claude Code's /usage and Codex's /status show them — the 5-hour and the
// weekly window, a per-model one when the plan has it — with the time to the next reset. Polled every minute; the
// server fetches the vendors at most once every few minutes for every tab together (lib/usage). A click opens the
// usage popover (decision:waterfall.status-bar-popover): one row per agent with its plan and the next reset, the
// memory in full, a refresh, and Detailed / Compact: detailed is bars with labels and resets, in the popover and on the
// bar; compact is one line per agent in the popover and percents only on the bar.
type Window = { label: string; percent: number; resetsAt?: string };
type Agent = { agent: 'claude' | 'codex'; plan?: string; windows: Window[]; error?: string; at: string };
type Status = { memory: { used: number; rss: number; heapUsed: number; external: number; capGb: number; pid: number; uptime: number }; agents: Agent[]; pollMs: number };

const gb = (b: number) => b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.round(b / 2 ** 20)} MB`;
// "2h 58m" / "4d 20h" — nothing when the reset has no time or is past
export function untilReset(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''; const ms = Date.parse(iso) - now; if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.round(ms / 60000); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24); return `${d}d ${h % 24}h`;
}
const uptime = (s: number) => s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`;
const NAMES = { claude: 'Claude', codex: 'Codex' };
const tone = (p: number) => p >= 90 ? 'bad' : p >= 70 ? 'warn' : '';
// the earliest reset among an agent's windows: what "Resets in" says
const nextReset = (a: Agent, now: number) => a.windows.map(w => w.resetsAt).filter((x): x is string => !!x && Date.parse(x) > now).sort()[0];

export function StatusBar() {
  const [s, setS] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [tick, setTick] = useState(0); // a refresh asks again now
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => { try { setCompact(localStorage.getItem('wf-statusbar') === 'compact'); } catch { /* no storage */ } }, []);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => { try { const r = await fetch('/api/usage'); if (r.ok && alive) setS(await r.json()); } catch { /* the bar keeps what it has */ } if (alive) timer = setTimeout(load, 60_000); };
    void load();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; if (timer) clearTimeout(timer); clearInterval(t); };
  }, [tick]);
  // the popover closes on a click outside it or Escape (the listener checks the target: app-router-document-listeners)
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const setMode = (c: boolean) => { setCompact(c); try { localStorage.setItem('wf-statusbar', c ? 'compact' : 'detailed'); } catch { /* ignore */ } };
  if (!s) return <div className="statusbar" ref={bar}><span className="sb-strip" /><CacheItem /></div>;
  const mem = s.memory; const pct = Math.round(mem.used / (mem.capGb * 2 ** 30) * 100);
  const Bar = ({ percent }: { percent: number }) => <span className="sb-bar"><i style={{ width: `${Math.min(100, percent)}%` }} /></span>;
  return (
    <div className={`statusbar ${open ? 'open' : ''}`} ref={bar}>
      <button type="button" className="sb-strip" onClick={() => setOpen(o => !o)} title="Memory and the agents' limits — click for the details" aria-expanded={open}>
        <span className={`sb-item ${tone(pct)}`}>{!compact && <Bar percent={pct} />}{gb(mem.used)}{!compact && <span className="muted"> of {mem.capGb} GB</span>}</span>
        {s.agents.map(a => (
          <span key={a.agent} className="sb-agent">
            <b>{NAMES[a.agent]}</b>
            {a.error ? <span className="muted">{a.error}</span> : a.windows.length === 0 ? <span className="muted">no limits</span> : a.windows.map(w => {
              const left = untilReset(w.resetsAt, now);
              return <span key={w.label} className={`sb-item ${tone(w.percent)}`}>{!compact && <Bar percent={w.percent} />}{w.percent}%{!compact && <span className="muted"> {w.label}{left ? ` · ${left}` : ''}</span>}</span>;
            })}
          </span>
        ))}
      </button>
      <CacheItem />
      {open && (
        <div className="sb-pop" role="dialog" aria-label="Usage">
          <div className="sb-pop-head"><b>Usage</b><span className="muted">every {Math.round(s.pollMs / 60000)} min</span><button type="button" className="mini" title="Ask again now" onClick={() => setTick(t => t + 1)}>↻</button></div>
          <div className="sb-seg" role="radiogroup"><button type="button" className={compact ? '' : 'on'} onClick={() => setMode(false)}>Detailed</button><button type="button" className={compact ? 'on' : ''} onClick={() => setMode(true)}>Compact</button></div>
          {s.agents.map(a => {
            const reset = untilReset(nextReset(a, now), now);
            return (
              <div key={a.agent} className={`sb-row ${compact ? 'compact' : ''}`}>
                <div className="sb-row-head"><b>{NAMES[a.agent]}</b>{a.plan && <span className="sb-plan">{a.plan}</span>}
                  {compact && !a.error && a.windows.map(w => <span key={w.label} className={`sb-item ${tone(w.percent)}`}>{w.percent}% <span className="muted">{w.label}</span></span>)}
                  <span className="muted">{a.error ? a.error : reset ? `Resets in ${reset}` : ''}</span></div>
                {!compact && !a.error && <div className="sb-windows">{a.windows.length === 0 ? <span className="muted">no limits reported</span> : a.windows.map(w => <span key={w.label} className={`sb-item ${tone(w.percent)}`}><span className="muted">{w.label}</span><Bar percent={w.percent} />{w.percent}%</span>)}</div>}
              </div>
            );
          })}
          <div className={`sb-row ${compact ? 'compact' : ''}`}>
            <div className="sb-row-head"><b>Memory</b>{compact && <span className={`sb-item ${tone(pct)}`}>{gb(mem.used)} <span className="muted">of {mem.capGb} GB</span></span>}<span className="muted">this server, pid {mem.pid}, up {uptime(mem.uptime)}</span></div>
            {!compact && <div className="sb-windows"><span className={`sb-item ${tone(pct)}`}><span className="muted">used</span><Bar percent={pct} />{gb(mem.used)}</span><span className="muted">heap {gb(mem.heapUsed)} · resident {gb(mem.rss)} · restarts past {mem.capGb} GB (WYE_MAX_MEMORY_GB), every session resumable</span></div>}
          </div>
          {!compact && <div className="sb-foot muted">Read from the same endpoints as <code>claude /usage</code> and <code>codex /status</code>, with this machine's logins; fetched {untilReset(new Date(Date.parse(s.agents[0]?.at ?? '') + s.pollMs).toISOString(), now) ? 'under' : 'over'} {Math.round(s.pollMs / 60000)} min ago.</div>}
        </div>
      )}
    </div>
  );
}

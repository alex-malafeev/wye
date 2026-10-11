'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SmartTag } from './SmartTag';
import type { Cleanup } from '@/lib/cleanup';

// req:waterfall.card-quality.cleanup — the scan, the list with each card's reason, and one Drop for the ticked ones
export function CleanupList({ product, initial }: { product: string; initial: Cleanup | null }) {
  const router = useRouter();
  const [list, setList] = useState<Cleanup | null>(initial);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'scan' | 'apply' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const post = async (body: object) => { const r = await fetch(`/api/${product}/cleanup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message ?? j.error ?? 'failed'); return j; };
  const scan = async () => { setBusy('scan'); setMsg(null); try { const j = await post({ action: 'scan' }); setList(j.cleanup); setTicked(new Set()); } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); } setBusy(null); };
  const apply = async () => {
    setBusy('apply'); setMsg(null);
    try { const j = await post({ action: 'apply', ids: [...ticked] }) as { done: string[]; failed: { id: string; message: string }[] }; setList(l => l && { ...l, items: l.items.filter(i => !j.done.includes(i.id)) }); setTicked(new Set()); setMsg(`${j.done.length} dropped${j.failed.length ? ` · not dropped: ${j.failed.map(f => `${f.id} (${f.message})`).join(', ')}` : ''}`); router.refresh(); }
    catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
    setBusy(null);
  };
  const toggle = (id: string) => setTicked(t => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = list?.items ?? [];
  return (
    <section className="cleanup">
      <div className="cleanup-bar">
        <button className="pri" disabled={!!busy} onClick={scan}>{busy === 'scan' ? 'Scanning… (a minute or two)' : list ? 'Scan again' : 'Scan this vault'}</button>
        {list && <span className="muted">{list.scanned} cards scanned {new Date(list.at).toLocaleString()} · {items.length} to look at{list.unjudged ? ` · ${list.unjudged} not judged (budget) — scan again` : ''}</span>}
        {items.length > 0 && <><button className="mini" onClick={() => setTicked(new Set(items.map(i => i.id)))}>Tick all</button><button disabled={!ticked.size || !!busy} onClick={apply}>{busy === 'apply' ? 'Dropping…' : `Drop ${ticked.size || ''}`}</button></>}
      </div>
      {msg && <p className="muted">{msg}</p>}
      {list && !items.length && <p className="muted">Nothing to clean up: no trivial card and no copy among the requirements and decisions.</p>}
      <ul className="cleanup-list">
        {items.map(i => (
          <li key={i.id} className={ticked.has(i.id) ? 'on' : ''}>
            <label><input type="checkbox" checked={ticked.has(i.id)} onChange={() => toggle(i.id)} />
              <span className={`cleanup-why ${i.why}`}>{i.why === 'duplicate' ? 'copy' : 'trivial'}</span>
              <SmartTag id={i.id} /> <span className="muted">{i.status}</span></label>
            <p>{i.title}</p>
            <p className="muted">{i.why === 'duplicate' && i.of ? <>repeats <SmartTag id={i.of} /> — </> : null}{i.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

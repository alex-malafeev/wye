'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// The bar on a skill, workflow or hooks page Wye ships (req:waterfall.global-skills.override): a shipped page says an
// edit makes this project's own copy; an own copy says so, and when the shipped text moved on since it was made, shows
// the new text and Use the shipped version — which removes the copy, so the page follows the install again.
type Status = { kind: 'shipped' } | { kind: 'own'; edited: boolean; behind: boolean; shippedText: string };

export function ShippedNotice({ product, project, slug, status }: { product: string; project: string; slug: string; status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (status.kind === 'shipped') return <div className="imported-notice shipped-notice"><span>Shipped with Wye — it changes when Wye is upgraded. An edit makes this product&apos;s own copy.</span></div>;
  const useShipped = async () => {
    setBusy(true); setMsg('');
    const r = await fetch(`/api/${product}/shipped`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, slug }) });
    setBusy(false);
    if (!r.ok) { setMsg((await r.json().catch(() => ({}))).message ?? 'could not remove the copy'); return; }
    router.refresh();
  };
  return (
    <div className={`imported-notice shipped-notice ${status.behind && status.edited ? 'behind' : ''}`}>
      <span>{status.behind && status.edited ? 'This product’s own copy — the shipped version has changed since it was made.' : 'This product’s own copy of a page Wye ships.'}</span>
      <button className={status.behind && status.edited ? 'pri' : ''} disabled={busy} onClick={useShipped}>{busy ? 'Removing…' : status.behind && status.edited ? 'Use the new version' : 'Use the shipped version'}</button>
      {msg && <span className="muted">{msg}</span>}
      {status.behind && status.edited && <details className="shipped-diff"><summary>The shipped version</summary><pre>{status.shippedText}</pre></details>}
    </div>
  );
}

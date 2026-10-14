'use client';
import { useEffect, useState } from 'react';
import { hasName, me, onLaptop, setMe } from '@/lib/collab/collab-client';

// Who is at this browser (plan:collaboration, decision:waterfall.collab-sign-in-later-names-first). On the person's own
// laptop nobody is asked: presence shows git's name, and writes stay "person" as before. On a server a new browser is
// asked for a name once; it is kept here, shown to the others on a page, and sent with every write this browser makes
// (x-wf-by), so the change history says who.
let patched = false;
function creditWrites() {
  if (patched) return; patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || !hasName()) return orig(input, init);
    let same = false; try { const u = new URL(url, location.href); same = u.origin === location.origin && u.pathname.startsWith('/api/'); } catch { /* not a URL */ }
    if (!same) return orig(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)); headers.set('x-wf-by', me().name);
    return orig(input, { ...init, headers });
  };
}

export function WhoAmI() {
  const [ask, setAsk] = useState(false); const [name, setName] = useState('');
  useEffect(() => {
    if (onLaptop()) { if (!hasName()) fetch('/api/system/me').then(r => r.json()).then(j => { if (j.name && !hasName()) setMe(j.name); }).catch(() => {}); return; }
    creditWrites();
    if (!hasName()) setAsk(true);
  }, []);
  if (!ask) return null;
  const save = () => { if (!name.trim()) return; setMe(name); setAsk(false); location.reload(); };
  return (
    <div className="whoami-veil" role="dialog" aria-label="Your name">
      <form className="whoami" onSubmit={e => { e.preventDefault(); save(); }}>
        <h2>Who are you?</h2>
        <p className="muted">Your name is shown to the others on a page while you are on it, and on what you change.</p>
        <input autoFocus aria-label="Your name" value={name} placeholder="Your name" onChange={e => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>Continue</button>
      </form>
    </div>
  );
}

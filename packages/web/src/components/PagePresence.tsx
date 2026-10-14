'use client';
import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { me, setMe } from '@/lib/collab/collab-client';

// Who is on this live page (plan:collaboration req:waterfall.collaboration.presence): one chip per person, their colour
// and name; the block each is in is marked in their colour. This browser's own chip renames it.
type Person = { id: number; name: string; color: string; block?: string; self: boolean };
export function PagePresence({ awareness }: { awareness: Awareness }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState(false); const [name, setName] = useState('');
  useEffect(() => {
    const read = () => setPeople([...awareness.getStates().entries()].flatMap(([id, st]) => {
      const u = (st as { user?: { name?: string; color?: string }; block?: string }).user; if (!u?.name) return [];
      return [{ id, name: u.name, color: u.color ?? '#888', block: (st as { block?: string }).block, self: id === awareness.clientID }];
    }).sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name)));
    read(); awareness.on('change', read); return () => awareness.off('change', read);
  }, [awareness]);
  const rename = () => { const n = name.trim(); if (n) { setMe(n); awareness.setLocalStateField('user', { ...me(), name: n }); } setEditing(false); };
  const others = people.filter(p => !p.self && p.block);
  // the block each other person is in, in their colour (the block ids are BlockNote's, never typed by a person)
  const css = others.map(p => { const b = `.bn-block[data-id="${CSS.escape(p.block!)}"]`; return `${b} > .bn-block-content, ${b} > .react-renderer > .bn-block-content { box-shadow: -3px 0 0 ${p.color}; }`; }).join('\n');
  return (
    <span className="page-presence" aria-label="On this page">
      {css && <style>{css}</style>}
      {people.map(p => p.self && editing
        ? <form key={p.id} className="pp-rename" onSubmit={e => { e.preventDefault(); rename(); }}><input autoFocus aria-label="Your name" value={name} onChange={e => setName(e.target.value)} onBlur={rename} /></form>
        : <button key={p.id} type="button" className={`pp-chip${p.self ? ' self' : ''}`} style={{ background: p.color }} data-person={p.name}
            title={p.self ? `${p.name} (you) — click to change your name` : `${p.name} is on this page`}
            onClick={p.self ? () => { setName(p.name); setEditing(true); } : undefined}>{p.name.slice(0, 1).toUpperCase()}</button>)}
      {people.length > 1 && <span className="pp-count muted">{people.length} here</span>}
    </span>
  );
}

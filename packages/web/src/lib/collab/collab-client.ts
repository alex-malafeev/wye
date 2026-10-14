'use client';
// The page editor's side of a live page (plan:collaboration): the page's Yjs document, kept in step with the server's
// over the websocket at /collab on this same address (wss:// behind https).
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import { FRAGMENT } from './collab-name';

export interface LiveDoc { name: string; doc: Y.Doc; awareness: Awareness; fragment: Y.XmlFragment; provider: HocuspocusProvider | null; closing?: ReturnType<typeof setTimeout> }
// the page's live document and who is on it — made with the editor, before it connects (no side effects: React may
// make it twice)
export function openLive(name: string): LiveDoc {
  const doc = new Y.Doc();
  return { name, doc, awareness: new Awareness(doc), fragment: doc.getXmlFragment(FRAGMENT), provider: null };
}
// connect when the editor mounts, close a moment after it unmounts — React's dev double mount reconnects in between,
// and a closed provider takes its awareness with it
export function connectLive(live: LiveDoc): HocuspocusProvider {
  if (live.closing) { clearTimeout(live.closing); live.closing = undefined; }
  const who = me(); const q = new URLSearchParams({ name: who.name, ...(onLaptop() ? {} : { by: '1' }) });
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab?${q}`;
  return (live.provider ??= new HocuspocusProvider({ url, name: live.name, document: live.doc, awareness: live.awareness }));
}
export function closeLive(live: LiveDoc): void {
  if (live.closing) clearTimeout(live.closing);
  live.closing = setTimeout(() => { live.provider?.destroy(); live.provider = null; }, 1000);
}

// store the page now rather than after the debounce — a new node must be in the graph at once (a comment is hung on it,
// a column asks for it). The editor's whole state goes along, so the store holds every edit made here so far even if
// the websocket has not delivered the last of them yet.
export async function storeNow(live: LiveDoc): Promise<{ ok: boolean; result?: string }> {
  const u = Y.encodeStateAsUpdate(live.doc); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  const r = await fetch('/api/system/collab', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: live.name, update: btoa(bin) }) });
  return r.json().catch(() => ({ ok: false }));
}

// who this browser is to the others on a page (plan:collaboration, decision:waterfall.collab-sign-in-later-names-first):
// the name the person gave on a server — or, on their own laptop, git's name, asked of nobody — and a colour kept with it
const COLOURS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#e03131', '#5f3dc4'];
export const onLaptop = () => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* no storage */ } };
export function me(): { name: string; color: string } {
  let color = read('wye-colour'); if (!color) { color = COLOURS[Math.floor(Math.random() * COLOURS.length)]; write('wye-colour', color); }
  return { name: read('wye-name') || 'Someone', color };
}
export const hasName = () => !!read('wye-name');
export function setMe(name: string, color?: string): void {
  write('wye-name', name.trim().slice(0, 60)); if (color) write('wye-colour', color);
  window.dispatchEvent(new CustomEvent('wye:me'));
}
export { COLOURS };

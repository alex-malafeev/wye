// A mention opens a preview drawer over the page it was clicked on; "Open full view" goes to the item itself.
import { S, h, chip, api, act, render, D, items, openFull, goalStatus } from './core.js';
import { rich, prune } from './rich.js';

export const peek = (kind, id) => { S.peek = kind ? { kind, id } : null; render(); };

export function peekDrawer() {
  const p = S.peek; if (!p) { prune(k => !k.startsWith('peek:')); return null; }
  const d = D(), shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close preview', onClick: () => peek(null) }), h('aside', { class: 'drawer' }, ...kids));
  let title, key, chips = [], body, save, opts;
  if (p.kind === 'doc') {
    const x = (d.docs || []).find(y => y.slug === p.id); if (!x) return shell(h('b', {}, 'Document not found'));
    title = x.title; key = x.key; chips = [x.folder ? chip('s-none', x.folder) : null]; body = x.body;
    save = md => act(() => api('PATCH', `/docs/${x.slug}`, { body: md })); opts = { kinds: ['link'], scope: `doc-${x.slug}`, project: '_library', plain: true };
  } else if (p.kind === 'goal') {
    const x = (d.goals || []).find(y => y.slug === p.id); if (!x) return shell(h('b', {}, 'Goal not found'));
    const [, label, cls] = goalStatus(x.status); title = x.title; key = x.key; chips = [chip(cls, label)]; body = x.body;
    save = md => act(() => api('PATCH', `/goals/${x.slug}`, { body: md })); opts = { kinds: ['link', 'update'], scope: `goal-${x.slug}`, project: '' };
  } else {
    const x = items().find(y => y.id === p.id); if (!x) return shell(h('b', {}, 'Initiative not found'));
    title = x.title; key = x.key; chips = [chip(x.statusClass, x.statusLabel), chip('s-none', x.tierLabel), chip('s-none', x.projectTitle)]; body = x.body;
    save = (md, base) => act(() => api('PATCH', `/initiatives/${x.id}`, { body: md, base })); opts = { node: x.node, idPrefix: `task:${x.project}.${x.slug}.`, scope: `${x.project}.${x.slug}`, project: x.project };
  }
  const ck = `peek:${p.kind}:${p.id}`;
  prune(k => !k.startsWith('peek:') || k === ck);   // only the previewed page's editor is kept
  return shell(
    h('div', { class: 'hrow between drawer-head', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('h2', { class: 'drawer-title' }, title),
      h('div', { class: 'hrow', style: 'gap:6px;flex-wrap:nowrap' }, h('button', { class: 'btn sm', onClick: () => { S.peek = null; openFull(p.kind, p.id); } }, 'Open full view ↗'), h('button', { class: 'btn sm', 'aria-label': 'Close', onClick: () => peek(null) }, '✕ Close'))),
    h('div', { class: 'hrow' }, key ? chip('s-none', key) : null, ...chips.filter(Boolean)),
    rich(ck, body, save, { minHeight: 200, ...opts }));
}

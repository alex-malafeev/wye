// The page editor: a Notion-style block editor (BlockNote, as in Wye's own editor) that reads and writes Markdown.
// The drawer is rebuilt after every change, so an editor is made once per page and the same element is handed back
// each time; and the page does not redraw while the person is typing in one (see app.js). If the editor's bundle is
// missing (npm run build:editor was not run) the field is a plain textarea, so nothing is ever uneditable.
import { h, D, items, openFull, openPerson } from './core.js';

const cache = new Map();                                       // key → { el, api, saved, base, onSave, opts }
let bundle;
const loadBundle = () => bundle || (bundle = import('/vendor/editor.js').then(m => { document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/editor.css' })); return m; }));

export const inEditor = el => !!(el && el.closest && el.closest('.rich, .bn-container, .mantine-Popover-dropdown, .bn-suggestion-menu, [data-mantine-stylesheet]'));

// rich(key, markdown, onSave(md, base), { minHeight, node, idPrefix }): `base` is the page as the editor last knew it
// from the server, so a save can keep what someone else added since (see Store.mergeBody)
// What "@" can link: documents, goals, projects and people. The link is written as Wye writes one, [title](kind:id), which
// Wye reads as a mention of that node.
const mentionList = () => {
  const d = D();
  return [
    ...(d.docs || []).map(x => ({ group: 'Documents', title: x.title, sub: [x.key, x.folder].filter(Boolean).join(' · '), href: `#/d/${x.slug}`, keywords: [x.key, x.category, x.folder].filter(Boolean) })),
    ...(d.goals || []).map(g => ({ group: 'Goals', title: g.title, sub: g.key, href: `#/g/${g.slug}`, keywords: [g.key] })),
    ...d.people.filter(p => p.inDirectory).map(p => ({ group: 'People', title: p.n, sub: p.role || '', href: `#/u/${p.slug}`, keywords: [p.role, p.team].filter(Boolean) })),
    ...items().map(i => ({ group: 'Projects', title: i.title, sub: `${i.key} · ${i.projectTitle}`, href: `#/i/${i.project}/${i.slug}`, keywords: [i.key] })),
  ];
};
const MENTION = /^#\/(d|g|i|u)\/(.+)$/;                                    // inside the editor a mention is an in-app path
export function openMention(href) {
  const m = MENTION.exec(href || ''); if (!m) return false;
  if (m[1] === 'd') openFull('doc', m[2]);
  else if (m[1] === 'g') openFull('goal', m[2]);
  else if (m[1] === 'i') openFull('initiative', m[2]);
  else { const p = D().people.find(x => x.slug === m[2]); if (p) openPerson(p.n); }
  return true;
}
export function rich(key, markdown, onSave, opts = {}) {
  let c = cache.get(key);
  if (c) {
    c.onSave = onSave;
    // changed elsewhere (the API, a webhook, another person) and not being typed in: show it
    if (!inEditor(document.activeElement)) { c.base = markdown; if (c.api && markdown.trim() !== c.saved.trim()) { c.saved = markdown; c.api.setMarkdown(markdown); } }
    return c.el;
  }
  const el = h('div', { class: 'rich', style: `min-height:${opts.minHeight || 90}px` }, h('div', { class: 'muted small', style: 'padding:8px 12px' }, 'Loading editor…'));
  c = { el, api: null, saved: markdown, base: markdown, onSave, opts };
  el.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && MENTION.test(a.getAttribute('href')) && openMention(a.getAttribute('href'))) { e.preventDefault(); e.stopPropagation(); } }, true);   // a link to a node goes there
  cache.set(key, c);
  const save = md => { if (md.trim() !== c.saved.trim()) { const base = c.base; c.saved = md; c.base = md; c.onSave(md, base); } };
  loadBundle().then(m => { el.replaceChildren(); c.api = m.mountEditor(el, { markdown: c.saved, onChange: save, node: opts.node, idPrefix: opts.idPrefix, kinds: opts.kinds,
    types: opts.plain ? [] : D().types, plain: !!opts.plain, mentions: mentionList, people: D().people.filter(p => p.inDirectory).map(p => ({ slug: p.slug, name: p.n })), scope: opts.scope, project: opts.project }); })
    .catch(() => { el.replaceChildren(h('textarea', { class: 'field', style: `min-height:${opts.minHeight || 90}px`, 'aria-label': 'Page', onChange: e => save(e.target.value) }, c.saved)); });
  return el;
}
// a block of one of the planner's kinds, inserted at the end of the page
export function insertInto(key, kind) { const c = cache.get(key); if (c && c.api) c.api.insert(kind); }
// editors whose key is not wanted any more (another initiative was opened, a dialog closed) are taken down
export function prune(wanted) { for (const [k, c] of cache) if (!wanted(k)) { if (c.api) c.api.destroy(); cache.delete(k); } }

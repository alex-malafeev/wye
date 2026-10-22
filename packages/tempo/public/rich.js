// Rich text fields: a Notion-style block editor (BlockNote, as in Wye's own editor) that reads and writes Markdown.
// The drawer is rebuilt after every change, so an editor is made once per field and the same element is handed back
// each time; and the page does not redraw while the person is typing in one (see app.js). If the editor's bundle is
// missing (npm run build:editor was not run) the field is a plain textarea, so nothing is ever uneditable.
import { h } from './core.js';

const cache = new Map();                                       // field key → { el, api, saved, onSave }
let bundle;
const loadBundle = () => bundle || (bundle = import('/vendor/editor.js').then(m => { document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/editor.css' })); return m; }));

export const inEditor = el => !!(el && el.closest && el.closest('.rich, .bn-container, .mantine-Popover-dropdown, .bn-suggestion-menu, [data-mantine-stylesheet]'));

export function rich(key, markdown, onSave, minHeight = 90) {
  let c = cache.get(key);
  if (c) {
    c.onSave = onSave;
    // changed elsewhere (the API, another person) and not being typed in: show it
    if (c.api && markdown.trim() !== c.saved.trim() && !inEditor(document.activeElement)) { c.saved = markdown; c.api.setMarkdown(markdown); }
    return c.el;
  }
  const el = h('div', { class: 'rich', style: `min-height:${minHeight}px` }, h('div', { class: 'muted small' }, 'Loading editor…'));
  c = { el, api: null, saved: markdown, onSave };
  cache.set(key, c);
  const save = md => { if (md.trim() !== c.saved.trim()) { c.saved = md; c.onSave(md); } };
  loadBundle().then(m => { el.replaceChildren(); c.api = m.mountEditor(el, { markdown: c.saved, onChange: save }); })
    .catch(() => { el.replaceChildren(h('textarea', { class: 'field', style: `min-height:${minHeight}px`, 'aria-label': 'Text', onChange: e => save(e.target.value) }, c.saved)); });
  return el;
}
// editors whose key is not wanted any more (another initiative was opened, a dialog closed) are taken down
export function prune(wanted) { for (const [k, c] of cache) if (!wanted(k)) { if (c.api) c.api.destroy(); cache.delete(k); } }

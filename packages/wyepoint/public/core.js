// Shared by every view: the page's state, the DOM helper, the API calls and the routing.
// All state comes from GET /api/state; every change is an API call followed by a reload of that state, so what is on
// screen is what is in the vault. The DOM is built with textContent only — nothing from the vault is ever HTML.
export const TABS = [['overview', 'Overview'], ['goals', 'Goals'], ['initiatives', 'Initiatives'], ['backlog', 'Backlog'], ['people', 'People'], ['library', 'Library'], ['plan', 'Plan'], ['history', 'History'], ['settings', 'Settings']];
export const TOKEN_KEY = 'wyepoint_token';

export const S = {
  data: null, peek: null, err: '', modal: null, confirmStart: false,
  f: { q: '', project: '', cycle: '', status: '', mission: '', tier: '', effort: '', champion: '' }, gy: 'project', gx: 'none', sortKey: 'rank', sortDir: 1,
  pq: '', pf: 'all', pt: '', selP: '', planQ: '', histSel: null,
  agents: {}, portfolio: { show: false, text: '' }, sim: null,   // the simulation open on an initiative: { id, title, result, text }
};
let renderer = () => {};
export const setRenderer = fn => { renderer = fn; };
export const render = () => renderer();

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
export const chip = (cls, text) => h('span', { class: 'chip ' + cls }, text);
export const bar = (pct, hot, big) => h('div', { class: 'bar' + (hot ? ' hot' : '') + (big ? ' big' : '') }, h('i', { style: `width:${Math.max(0, Math.min(100, pct || 0))}%` }));
export const muted = (text, cls = '') => h('div', { class: 'muted ' + cls }, text);
export const safeUrl = u => /^https?:\/\//i.test(u) ? u : '#';
export const label = (text, el, style) => h('label', { class: 'f', style }, h('span', { class: 'lbl' }, text), el);
export const opts = (list, current) => list.map(([v, l]) => h('option', { value: v, selected: String(current) === String(v) }, l));

// ---- api
export async function api(method, path, body, retry = true) {
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('tempo_token') || ''; } catch { /* storage blocked */ }
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && retry && method !== 'GET') {
    const t = window.prompt('This server needs its write token to save changes:');
    if (t) { try { localStorage.setItem(TOKEN_KEY, t.trim()); } catch { /* storage blocked */ } return api(method, path, body, false); }
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}
// a change, then a reload; a failure is shown where the person is looking
export async function act(fn, done) {
  try { await fn(); S.err = ''; await load(); if (done) done(); } catch (e) { S.err = e.message; render(); }
}
export async function load() { S.data = await api('GET', '/state'); render(); }

// ---- routing: #/<view>?i=<project>/<slug>
export function route() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  const byKey = /^k\/([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(p); if (byKey) return { view: 'key', key: byKey[1].toUpperCase(), open: null, project: null };
  const full = /^(i|p|g|d)\/(.+)$/.exec(p);                 // a full view: #/i/<project>/<slug> or #/p/<project>
  if (full) return { view: 'full', full: { kind: { i: 'initiative', p: 'project', g: 'goal', d: 'doc' }[full[1]], id: decodeURIComponent(full[2]) }, open: null, project: null };
  const sp = new URLSearchParams(q || '');
  if (p === 'projects') return { view: 'initiatives', open: null, project: sp.get('p'), person: null };   // the name it had
  return { view: TABS.some(t => t[0] === p) ? p : 'overview', open: sp.get('i'), project: sp.get('p'), person: sp.get('u') };
}
// the page's address: a view, and optionally an initiative (i) or a project (p) open on top of it
export function go(view, open, project, person) {
  const q = open ? `i=${encodeURIComponent(open).replace(/%2F/g, '/')}` : project ? `p=${encodeURIComponent(project)}` : person ? `u=${encodeURIComponent(person)}` : '';
  location.hash = `#/${view}` + (q ? '?' + q : '');
}
// opening an initiative or a project from a full view goes to its full view; from anywhere else, to a drawer over the page
export const openFull = (kind, id) => { location.hash = `#/${{ initiative: 'i', project: 'p', goal: 'g', doc: 'd' }[kind]}/${id}`; };
export const openIt = id => { const r = route(); if (id && (r.view === 'backlog' || r.view === 'initiatives')) return openFull('initiative', id);   // the backlog and the initiatives page open an item full screen
  if (r.view === 'full') { if (id) openFull('initiative', id); else history.back(); } else go(r.view, id); };
export const openProject = slug => { const r = route(); if (r.view === 'full') { if (slug) openFull('project', slug); else history.back(); } else go(r.view, null, slug); };   // null closes it
// leaving a full view: back to where it was opened from, or to the backlog if it was opened directly
// How deep in this visit's own history the page is, so Back goes back where there is somewhere in the app to go, and to the page the
// item belongs to where there is not (a link opened it, or the page was reloaded at its start).
let depth = (history.state && history.state.n) || 0, top = depth;
if (!(history.state && typeof history.state.n === 'number')) history.replaceState({ n: 0 }, '');
window.addEventListener('hashchange', () => {
  const n = history.state && history.state.n;
  if (typeof n === 'number') depth = n;                                  // an entry visited before: Back or Forward
  else { depth = ++top; history.replaceState({ n: depth }, ''); }        // a new one
});
const HOME = { initiative: 'initiatives', project: 'initiatives', goal: 'goals', doc: 'library' };
export const closeFull = () => { if (depth > 0) history.back(); else go(HOME[(route().full || {}).kind] || 'backlog'); };
// a person opens in a drawer over whatever page is showing (a full view goes to People); null closes it
export function openPerson(n) { S.err = ''; const r = route(); go(r.view === 'full' ? 'people' : r.view, null, null, n || undefined); }

// ---- lookups and formatting over the loaded state
export const D = () => S.data;
export const items = () => S.data.initiatives;
export const cyc = n => S.data.cycles.find(c => c.n === n) || { n, name: `Cycle ${n}`, start: '', end: '', status: 'planned', rows: [] };
export const fmtDate = s => { const d = new Date(s + 'T00:00:00Z'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
export const range = c => `${fmtDate(c.start)} – ${fmtDate(c.end)}`;
export const stClass = label => ({ 'On Track': 's-on', 'At Risk': 's-risk', 'Off Track': 's-off', 'Not Started': 's-ns', Shipped: 's-ship' }[label] || 's-none');
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const cycleChip = c => chip({ closed: 's-ns', active: 's-on', released: 's-ship', planned: 's-none' }[c.status] || 's-none', cap(c.status));

// Every project, milestone and typed item has a global key (PROJ-12, TASK-5, RISK-2). It names the item wherever it is
// written, and #/k/<KEY> opens it: a project in its full view, anything inside one in the project it belongs to.
export function findKey(k) {
  const key = String(k || '').trim().toUpperCase().replace(/^PROJ-/, 'INIT-');   // PROJ-n was the key of an initiative for a while
  for (const i of items()) {
    if (i.key === key) return { id: i.id, href: `#/i/${i.id}`, what: 'project', title: i.title };
    const t = i.tasks.find(x => x.key === key); if (t) return { id: i.id, href: `#/i/${i.id}`, what: 'milestone', title: t.title };
    const n = (i.nodes || []).find(x => (x.props || {}).key === key); if (n) return { id: i.id, href: `#/i/${i.id}`, what: n.kind, title: n.text };
  }
  const g = (S.data.goals || []).find(x => x.key === key); if (g) return { id: g.slug, href: `#/g/${g.slug}`, what: 'goal', title: g.title };
  const d = (S.data.docs || []).find(x => x.key === key); if (d) return { id: d.slug, href: `#/d/${d.slug}`, what: 'document', title: d.title };
  return null;
}
// a tag: the one pill the page uses for a status, a cycle, a team, a key; a status has a dot of its colour
export const tag = (text, dot, title) => h('span', { class: 'tag', title }, dot ? h('i', { class: 'tdot ' + dot, 'aria-hidden': 'true' }) : null, text);
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

// how a goal's status reads: [value, label, chip class]
export const GOAL_STATUS = [['proposed', 'Proposed', 's-none'], ['on-track', 'On Track', 's-on'], ['at-risk', 'At Risk', 's-risk'], ['off-track', 'Off Track', 's-off'], ['paused', 'Paused', 's-none'], ['complete', 'Done', 's-ship']];
export const goalStatus = v => GOAL_STATUS.find(x => x[0] === v) || ['', 'No status', 's-none'];

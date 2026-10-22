// Shared by every view: the page's state, the DOM helper, the API calls and the routing.
// All state comes from GET /api/state; every change is an API call followed by a reload of that state, so what is on
// screen is what is in the vault. The DOM is built with textContent only — nothing from the vault is ever HTML.
export const TABS = [['overview', 'Overview'], ['projects', 'Projects'], ['backlog', 'Backlog'], ['people', 'People'], ['sim', 'Simulate'], ['plan', 'Plan'], ['history', 'History'], ['settings', 'Settings']];
export const TOKEN_KEY = 'tempo_token';

export const S = {
  data: null, err: '', modal: null, confirmStart: false,
  f: { q: '', project: '', status: '', mission: '', tier: '', effort: '', champion: '' }, gy: 'project', gx: 'none', sortKey: 'rank', sortDir: 1,
  pq: '', pf: 'all', selP: '', planQ: '', histSel: null,
  agents: {}, portfolio: { show: false, text: '' }, sim: { title: '', description: '', effort: 'M', when: 'cycle3', result: null, text: '' },
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
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage blocked */ }
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
  return { view: TABS.some(t => t[0] === p) ? p : 'overview', open: new URLSearchParams(q || '').get('i') };
}
export function go(view, open) { location.hash = `#/${view}` + (open ? `?i=${encodeURIComponent(open).replace(/%2F/g, '/')}` : ''); }
export const openIt = id => go(route().view, id);
export function openPerson(n) { S.selP = n; S.err = ''; go('people'); }

// ---- lookups and formatting over the loaded state
export const D = () => S.data;
export const items = () => S.data.initiatives;
export const cyc = n => S.data.cycles.find(c => c.n === n) || { n, name: `Cycle ${n}`, start: '', end: '', status: 'planned', rows: [] };
export const fmtDate = s => { const d = new Date(s + 'T00:00:00Z'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
export const range = c => `${fmtDate(c.start)} – ${fmtDate(c.end)}`;
export const stClass = label => ({ 'On Track': 's-on', 'At Risk': 's-risk', 'Off Track': 's-off', 'Not Started': 's-ns', Shipped: 's-ship' }[label] || 's-none');
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const cycleChip = c => chip({ closed: 's-ns', active: 's-on', released: 's-ship', planned: 's-none' }[c.status] || 's-none', cap(c.status));

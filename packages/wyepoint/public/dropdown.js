// A dropdown in the page's own style, in place of the browser's: the chosen value on a button, the choices in a menu that
// opens under it, with a tick on the current one. Arrow keys, Enter and Escape work; a click elsewhere closes it.
// dropdown([[value, label], …], value, onChange(value), label, { compact, search, placeholder })
// With `search` the menu opens with a box to type in, for a long list; `placeholder` is what the button says when nothing is chosen.
import { h } from './core.js';

let open = null;                                                       // the one menu that is open: { root, menu, close }
document.addEventListener('mousedown', e => { if (open && !open.root.contains(e.target)) open.close(); });
window.addEventListener('resize', () => open && open.close());
document.addEventListener('scroll', e => { if (open && !open.menu.contains(e.target)) open.close(); }, true);

export function dropdown(list, value, onChange, label, { compact = false, search = false, placeholder = '', tag = false, dot = '' } = {}) {
  const same = (a, b) => String(a) === String(b);
  const cur = list.find(x => same(x[0], value));
  let shown = list, at = Math.max(0, list.findIndex(x => same(x[0], value)));
  const btn = h('button', { type: 'button', class: 'pfield dd-btn' + (compact ? ' compact' : '') + (tag ? ' tagged' : ''), 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, title: label },
    tag && cur ? h('span', { class: 'tag' }, dot ? h('i', { class: 'tdot ' + dot, 'aria-hidden': 'true' }) : null, cur[1]) : h('span', { class: 'dd-val' + (!cur && placeholder ? ' dd-ph' : '') }, cur ? cur[1] : placeholder), h('span', { class: 'dd-caret', 'aria-hidden': 'true' }, '⌄'));
  const box = search ? h('input', { class: 'dd-search', type: 'search', placeholder: 'Search…', 'aria-label': `Search ${label.toLowerCase()}`, autocomplete: 'off' }) : null;
  const items = h('div', { class: 'dd-items' });
  const menu = h('div', { class: 'dd-menu', role: 'listbox', 'aria-label': label }, ...(box ? [box] : []), items); menu.hidden = true;
  const root = h('div', { class: 'dd' }, btn, menu);
  const mark = () => { [...items.children].forEach((el, k) => el.classList.toggle('on', k === at)); const on = items.children[at]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); };
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (open && open.root === root) open = null; };
  const pick = v => { close(); if (!same(v, value)) onChange(v); };
  const paint = () => {
    items.replaceChildren(...(shown.length ? shown.map(([v, l], k) => h('div', { class: 'dd-opt' + (k === at ? ' on' : ''), role: 'option', 'aria-selected': String(same(v, value)),
      onMouseDown: e => { e.preventDefault(); pick(v); }, onMouseEnter: () => { at = k; mark(); } }, h('span', { class: 'dd-check' }, same(v, value) ? '✓' : ''), h('span', {}, l)))
      : [h('div', { class: 'dd-empty' }, 'Nothing matches.')]));
  };
  const show = () => {
    if (open) open.close();
    shown = list; at = Math.max(0, list.findIndex(x => same(x[0], value))); if (box) box.value = '';
    paint(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();                                // fixed, so a panel that scrolls or clips does not hide it
    const below = window.innerHeight - r.bottom, room = Math.min(340, list.length * 34 + (box ? 56 : 12));
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 260)) + 'px';
    menu.style.minWidth = Math.max(r.width, search ? 260 : 160) + 'px';
    if (below < room + 12 && r.top > below) { menu.style.top = 'auto'; menu.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 4) + 'px'; }
    open = { root, menu, close };
    if (box) setTimeout(() => box.focus(), 0);
    mark();
  };
  const move = d => { at = Math.max(0, Math.min(shown.length - 1, at + d)); mark(); };
  const onKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (menu.hidden) show(); else move(e.key === 'ArrowDown' ? 1 : -1); }
    else if ((e.key === 'Enter' || (e.key === ' ' && !box)) && !menu.hidden) { e.preventDefault(); if (shown[at]) pick(shown[at][0]); }
    else if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(); btn.focus(); }
  };
  btn.addEventListener('click', () => (menu.hidden ? show() : close()));
  btn.addEventListener('keydown', onKey);
  if (box) {
    box.addEventListener('keydown', onKey);
    box.addEventListener('input', () => { const q = box.value.trim().toLowerCase(); shown = q ? list.filter(x => String(x[1]).toLowerCase().includes(q)) : list; at = 0; paint(); });
  } else btn.addEventListener('blur', () => { setTimeout(() => { if (!root.contains(document.activeElement) && !menu.hidden) close(); }, 120); });
  return root;
}

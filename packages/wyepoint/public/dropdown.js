// A dropdown in the page's own style, in place of the browser's: the chosen value on a button, the choices in a menu that
// opens under it, with a tick on the current one. Arrow keys, Enter and Escape work; a click elsewhere closes it.
// dropdown([[value, label], …], value, onChange(value), label, { compact })
import { h } from './core.js';

let open = null;                                                       // the one menu that is open: { root, close }
document.addEventListener('mousedown', e => { if (open && !open.root.contains(e.target)) open.close(); });
window.addEventListener('resize', () => open && open.close());
document.addEventListener('scroll', e => { if (open && !open.menu.contains(e.target)) open.close(); }, true);

export function dropdown(list, value, onChange, label, { compact = false } = {}) {
  const same = (a, b) => String(a) === String(b);
  const cur = list.find(x => same(x[0], value));
  let at = Math.max(0, list.findIndex(x => same(x[0], value)));
  const btn = h('button', { type: 'button', class: 'pfield dd-btn' + (compact ? ' compact' : ''), 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, title: label },
    h('span', { class: 'dd-val' }, cur ? cur[1] : ''), h('span', { class: 'dd-caret', 'aria-hidden': 'true' }, '⌄'));
  const menu = h('div', { class: 'dd-menu', role: 'listbox', 'aria-label': label }); menu.hidden = true;
  const root = h('div', { class: 'dd' }, btn, menu);
  const mark = () => [...menu.children].forEach((el, k) => el.classList.toggle('on', k === at));
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (open && open.root === root) open = null; };
  const pick = v => { close(); if (!same(v, value)) onChange(v); };
  const show = () => {
    if (open) open.close();
    menu.replaceChildren(...list.map(([v, l], k) => h('div', { class: 'dd-opt' + (k === at ? ' on' : ''), role: 'option', 'aria-selected': String(same(v, value)),
      onMouseDown: e => { e.preventDefault(); pick(v); }, onMouseEnter: () => { at = k; mark(); } }, h('span', { class: 'dd-check' }, same(v, value) ? '✓' : ''), h('span', {}, l))));
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();                                // fixed, so a panel that scrolls or clips does not hide it
    const below = window.innerHeight - r.bottom, room = Math.min(300, list.length * 34 + 12);
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 220)) + 'px';
    menu.style.minWidth = Math.max(r.width, 160) + 'px';
    if (below < room + 12 && r.top > below) { menu.style.top = 'auto'; menu.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 4) + 'px'; }
    open = { root, menu, close };
  };
  btn.addEventListener('click', () => (menu.hidden ? show() : close()));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (menu.hidden) show(); else { at = Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))); mark(); } }
    else if ((e.key === 'Enter' || e.key === ' ') && !menu.hidden) { e.preventDefault(); pick(list[at][0]); }
    else if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(); }
  });
  btn.addEventListener('blur', () => { setTimeout(() => { if (!root.contains(document.activeElement) && !menu.hidden) close(); }, 120); });
  return root;
}

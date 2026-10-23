// A person lookup: type a name, pick from the people in the directory (with their role, team and load, so it shows who
// has room); a name that is not in it can still be used as typed. One person (a champion), or several (contributors).
import { h, chip, D } from './core.js';

// personPicker({ value: 'Dana' | ['Dana', 'Lee'], multi, onChange(name | names), placeholder, label })
export function personPicker({ value, multi = false, onChange, placeholder = '', label = 'Person' }) {
  const chosen = multi ? [...value] : (value ? [value] : []);
  const has = n => chosen.some(c => c.toLowerCase() === n.toLowerCase());
  const input = h('input', { class: 'pfield picker-input', placeholder: chosen.length && multi ? 'Add another' : placeholder, 'aria-label': label, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', value: multi ? '' : (value || '') });
  const menu = h('div', { class: 'picker-menu', role: 'listbox' }); menu.hidden = true;
  let options = [], at = 0, committed = false;

  const commit = raw => {
    const name = String(raw || '').trim(); committed = true; close();
    if (multi) { if (name && !has(name)) onChange([...chosen, name]); else input.value = ''; }
    else if (name !== (value || '')) onChange(name);
  };
  const find = () => {
    const q = input.value.trim().toLowerCase();
    const starts = p => p.n.toLowerCase().startsWith(q) ? 0 : 1;
    // what is typed is a name: names that contain it; only when none does, people whose role or team does
    const pool = D().people.filter(p => !(multi && has(p.n)));
    let found = q ? pool.filter(p => p.n.toLowerCase().includes(q)) : pool;
    if (q && !found.length) found = pool.filter(p => `${p.role} ${p.team}`.toLowerCase().includes(q));
    const people = found.sort((a, b) => starts(a) - starts(b) || a.load.score - b.load.score).slice(0, 8);   // those with room first
    options = people.map(p => ({ name: p.n, p }));
    if (q && !D().people.some(p => p.n.toLowerCase() === q)) options.push({ name: input.value.trim(), typed: true });
    at = Math.min(at, Math.max(0, options.length - 1));
  };
  const paint = () => {
    menu.replaceChildren(...(options.length ? options.map((o, k) => h('div', { class: 'picker-opt' + (k === at ? ' on' : ''), role: 'option', 'aria-selected': k === at ? 'true' : 'false',
      // mousedown, not click: the input must keep focus until the choice is made
      onMouseDown: e => { e.preventDefault(); commit(o.name); } },
      o.typed ? h('span', {}, `Use “${o.name}”`, h('small', {}, 'Not in the directory')) : h('span', {}, h('b', {}, o.p.n), h('small', {}, [o.p.role, o.p.team].filter(Boolean).join(' · ') || 'No role or team')),
      o.typed ? null : chip(o.p.tagClass, o.p.tag))) : [h('div', { class: 'picker-empty' }, D().people.length ? 'Nobody else matches.' : 'No people yet. Add them on the People page.')]));
  };
  const open = () => { find(); paint(); menu.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  function close() { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); }

  input.addEventListener('focus', () => { committed = false; if (!multi) input.select(); open(); });
  input.addEventListener('input', () => { at = 0; open(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.hidden) open(); at = Math.min(at + 1, options.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); paint(); }
    else if (e.key === 'Enter' || (multi && e.key === ',')) { e.preventDefault(); const o = options[at]; commit(!menu.hidden && o ? o.name : input.value); }
    else if (e.key === 'Escape') { close(); input.value = multi ? '' : (value || ''); input.blur(); }
    else if (e.key === 'Backspace' && multi && !input.value && chosen.length) onChange(chosen.slice(0, -1));
  });
  // leaving the field with a name typed in uses it, so nothing typed is lost; leaving a single field empty clears it
  input.addEventListener('blur', () => { close(); if (!committed) { if (multi) { if (input.value.trim()) commit(input.value); } else commit(input.value); } });

  const root = h('div', { class: 'picker' + (multi ? ' multi' : '') },
    ...(multi ? chosen.map(n => h('span', { class: 'pchip' }, n, h('button', { type: 'button', 'aria-label': `Remove ${n}`, onClick: () => onChange(chosen.filter(c => c !== n)) }, '✕'))) : []),
    input, menu);
  return root;
}

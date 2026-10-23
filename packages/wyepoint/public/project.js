// A project's page: its details over one page of its own — what it is, links, anything else — edited like an initiative.
import { S, h, chip, bar, muted, api, act, render, openProject, openFull, openIt, openPerson, items, D } from './core.js';
import { rich, prune } from './rich.js';
import { itemRow, list } from './views.js';
import { personPicker } from './picker.js';
import { newInitiativePage } from './drawer.js';

const prop = (name, el) => h('div', { class: 'prop' }, h('div', { class: 'prop-name' }, name), h('div', { class: 'prop-val' }, el));

export function projectDrawer(slug) {
  const p = D().projects.find(x => x.slug === slug);
  const shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close area', onClick: () => openProject(null) }), h('aside', { class: 'drawer' }, ...kids));
  if (!p) return shell(h('div', { class: 'hrow between' }, h('b', {}, 'Area not found'), h('button', { class: 'btn sm', onClick: () => openProject(null) }, 'Close')));
  const upd = patch => act(() => api('PATCH', `/projects/${p.slug}`, patch));
  const mine = items().filter(i => i.project === p.slug), cy = mine.filter(i => i.tier === 'cycle');
  const avg = cy.length ? Math.round(cy.reduce((s, i) => s + i.progress, 0) / cy.length) : 0;
  const mix = {}; mine.forEach(i => { mix[i.statusLabel] = (mix[i.statusLabel] || 0) + 1; });
  const people = [...new Set(mine.flatMap(i => [i.owner, ...i.contributors]).filter(Boolean))];
  const key = `project:${p.slug}:body`;
  prune(k => k.startsWith(`project:${p.slug}:`) || k.startsWith('modal:'));
  const page = rich(key, p.body, (md, base) => upd({ body: md, base }), { minHeight: 200, kinds: ['link', 'update'], scope: `${p.slug}`, project: p.slug });
  return shell(
    h('div', { class: 'hrow between drawer-head', style: 'align-items:flex-start;flex-wrap:nowrap' },
      h('input', { class: 'drawer-title-input', value: p.title, 'aria-label': 'Area name', onChange: e => upd({ title: e.target.value }) }),
      h('div', { class: 'hrow', style: 'gap:6px;flex-wrap:nowrap' }, h('button', { class: 'btn sm', onClick: () => openFull('project', p.slug) }, 'Open full view ↗'), h('button', { class: 'btn sm', 'aria-label': 'Close', onClick: () => openProject(null) }, '✕ Close'))),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, chip('s-none', `${mine.length} project${mine.length === 1 ? '' : 's'}`), chip('s-none', `${cy.length} in the active cycle`), ...Object.entries(mix).map(([l, n]) => chip('s-none', `${n} ${l.toLowerCase()}`))),
    h('div', { class: 'props' },
      prop('Owner', personPicker({ value: p.owner, onChange: v => upd({ owner: v }), placeholder: 'No owner', label: 'Owner' })),
      prop('Progress', h('div', {}, h('div', { class: 'hrow between small', style: 'flex-wrap:nowrap' }, h('span', { class: 'muted' }, 'Average of the active cycle'), h('b', {}, avg + '%')), bar(avg, cy.some(i => i.status === 'off-track')))),
      people.length ? prop('People', h('div', { class: 'hrow' }, ...people.map(n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n)))) : null),

    page,

    h('div', { class: 'stack' }, h('div', { class: 'hrow between' }, h('div', { class: 'lbl' }, `Projects (${mine.length})`),
      h('button', { class: 'btn sm', onClick: () => newInitiativePage(p.slug) }, '+ New project')),
      list(mine.map(i => itemRow(i, `${i.owner || 'No champion'} · ${i.cycle == null ? 'Backlog' : 'Cycle ' + i.cycle}`))), mine.length ? null : muted('No projects yet.', 'small')),
    h('div', { class: 'muted small' }, 'Stored in the vault as ', h('code', {}, `areas/${p.slug}/_area.md`), '.'));
}

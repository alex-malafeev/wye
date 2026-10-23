// A person's drawer, like a project's or an area's: who they are, how loaded they are, and what they carry.
import { S, h, chip, muted, api, act, openPerson, items, D } from './core.js';
import { itemRow, list, meter, LOAD_RULE } from './views.js';

const prop = (name, el) => h('div', { class: 'prop' }, h('div', { class: 'prop-name' }, name), h('div', { class: 'prop-val' }, el));

export function personDrawer(name) {
  const p = D().people.find(x => x.n === name);
  const shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close person', onClick: () => openPerson(null) }), h('aside', { class: 'drawer' }, ...kids));
  if (!p) return shell(h('div', { class: 'hrow between' }, h('b', {}, 'Person not found'), h('button', { class: 'btn sm', onClick: () => openPerson(null) }, '✕ Close')));
  const byId = Object.fromEntries(items().map(i => [i.id, i]));
  const field = (label, key, ph) => h('input', { class: 'pfield', value: p[key], placeholder: ph, disabled: !p.inDirectory, 'aria-label': label, onChange: e => act(() => api('PATCH', `/people/${p.slug}`, { [key]: e.target.value })) });
  const source = !p.inDirectory ? 'Named on projects, not in the directory yet' : p.source === 'manual' ? 'Added by hand' : `Synced from ${p.source}`;
  const carrying = [...p.ch.map(id => [byId[id], 'Champion']), ...p.co.map(id => [byId[id], 'Contributor'])].filter(x => x[0]);
  return shell(
    h('div', { class: 'hrow between drawer-head', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('h2', { class: 'drawer-title' }, p.n),
      h('div', { class: 'hrow', style: 'gap:6px;flex-wrap:nowrap' },
        p.inDirectory ? h('button', { class: 'btn sm', onClick: () => { openPerson(null); act(() => api('DELETE', `/people/${p.slug}`)); } }, 'Remove')
          : h('button', { class: 'btn sm pri', onClick: () => act(() => api('POST', '/people', { name: p.n })) }, 'Add to directory'),
        h('button', { class: 'btn sm', 'aria-label': 'Close', onClick: () => openPerson(null) }, '✕ Close'))),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, chip(p.tagClass, p.tag), chip('s-none', `Load ${p.load.score} of 10`), chip('s-none', source)),
    h('div', { class: 'props' },
      prop('Role', field('Role', 'role', 'No role')), prop('Team', field('Team', 'team', 'No team')), prop('Email', field('Email', 'email', 'No email')),
      prop('Load', h('div', { class: 'pd-load' }, meter(p), muted(LOAD_RULE, 'small')))),
    h('div', { class: 'stack' }, h('div', { class: 'lbl' }, `Carrying (${carrying.length})`),
      list(carrying.map(([i, role]) => itemRow(i, `${role} · ${i.projectTitle} · ${i.tierLabel}`))),
      carrying.length ? null : muted('Not on any project, so they have room. Name them as a champion or contributor on one to give them work.', 'small')),
    h('div', { class: 'muted small' }, p.inDirectory ? ['Stored in the vault as ', h('code', {}, `people/${p.slug}.md`), '.'] : 'Add them to the directory to give them a role, a team and an email.'));
}

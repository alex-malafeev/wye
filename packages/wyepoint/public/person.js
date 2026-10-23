// A person's drawer, like an initiative's or a team's: who they are, how loaded they are, and what they carry.
import { S, h, chip, muted, api, act, openPerson, openIt, openFull, items, D, goalStatus } from './core.js';

const TASK = { todo: 'Not started', 'in-progress': 'In progress', review: 'In review', blocked: 'Blocked', done: 'Done' };
import { itemRow, list, meter, LOAD_RULE } from './views.js';

const prop = (name, el) => h('div', { class: 'prop' }, h('div', { class: 'prop-name' }, name), h('div', { class: 'prop-val' }, el));

export function personDrawer(name) {
  const p = D().people.find(x => x.n === name);
  const shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close person', onClick: () => openPerson(null) }), h('aside', { class: 'drawer' }, ...kids));
  if (!p) return shell(h('div', { class: 'hrow between' }, h('b', {}, 'Person not found'), h('button', { class: 'btn sm', onClick: () => openPerson(null) }, '✕ Close')));
  const byId = Object.fromEntries(items().map(i => [i.id, i]));
  const field = (label, key, ph) => h('input', { class: 'pfield', value: p[key], placeholder: ph, disabled: !p.inDirectory, 'aria-label': label, onChange: e => act(() => api('PATCH', `/people/${p.slug}`, { [key]: e.target.value })) });
  const source = !p.inDirectory ? 'Named on initiatives, not in the directory yet' : p.source === 'manual' ? 'Added by hand' : `Synced from ${p.source}`;
  const L = p.links || { goals: [], milestones: [], risks: [], history: [] };
  const section = (title, rows, row) => (rows.length ? h('div', { class: 'stack' }, h('div', { class: 'lbl' }, `${title} (${rows.length})`), h('div', { class: 'mini-list' }, ...rows.map(row))) : null);
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
      carrying.length ? null : muted('Not on any initiative, so they have room. Name them as a champion or contributor on one to give them work.', 'small')),
    section('Goals they own', L.goals, g => h('button', { class: 'mini', onClick: () => openFull('goal', g.slug) }, h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, g.title, h('span', { class: 'mini-key' }, g.key)), h('span', { class: 'mini-sub' }, 'Goal')), h('span', { class: 'mini-chips' }, chip(goalStatus(g.status)[2], goalStatus(g.status)[1])))),
    section('Milestones they own', L.milestones, m => h('button', { class: 'mini', onClick: () => openIt(m.project) }, h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, m.title, m.key ? h('span', { class: 'mini-key' }, m.key) : null), h('span', { class: 'mini-sub' }, `${m.projectTitle}${m.due ? ' · due ' + m.due : ''}`)), h('span', { class: 'mini-chips' }, chip(m.status === 'done' ? 's-ship' : m.status === 'blocked' ? 's-off' : 's-ns', TASK[m.status] || m.status)))),
    section('Risks they are responsible for', L.risks, r => h('button', { class: 'mini', onClick: () => openIt(r.project) }, h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, r.title, r.key ? h('span', { class: 'mini-key' }, r.key) : null), h('span', { class: 'mini-sub' }, `${r.projectTitle}${r.severity ? ' · ' + r.severity : ''}`)), h('span', { class: 'mini-chips' }, chip(/closed|mitigated/.test(r.status) ? 's-ship' : 's-risk', r.status || 'open')))),
    h('div', { class: 'stack' }, h('div', { class: 'lbl' }, `History (${L.history.length})`),
      L.history.length ? h('div', { class: 'timeline' }, ...L.history.map(e => h('div', { class: 'tl-row' }, h('span', { class: 'hist-dot', 'aria-hidden': 'true' }),
        e.kind === 'cycle' ? h('div', {}, h('div', {}, h('b', {}, `Cycle ${e.cycle}`), ` · championed ${e.title}`), h('div', { class: 'muted small' }, `${e.pct}% when it closed${e.ts ? ' · ' + e.ts : ''}`))
          : h('button', { class: 'tl-link', onClick: () => openIt(e.project) }, h('div', {}, e.text), h('div', { class: 'muted small' }, `${e.projectTitle} · ${e.source} · ${String(e.ts).replace('T', ' ').replace('Z', '')}`))))) : muted('Nothing yet. Cycles they championed and updates that name them show up here.', 'small')),
    h('div', { class: 'muted small' }, p.inDirectory ? ['Stored in the vault as ', h('code', {}, `people/${p.slug}.md`), '.'] : 'Add them to the directory to give them a role, a team and an email.'));
}

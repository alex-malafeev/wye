// The initiative drawer — a property sheet over one page, like a Notion or Wye page — and the two "new" dialogs.
import { S, h, chip, bar, muted, opts, api, act, render, go, route, openIt, openFull, openPerson, items, cyc, D } from './core.js';
import { runItemAgent } from './views.js';
import { rich, prune, insertInto } from './rich.js';
import { openSimulation, canSimulate } from './simulate.js';

export const BUCKETS = [['proposed', 'Proposed'], ['next', 'Next cycle'], ['later', 'Later'], ['icebox', 'Icebox']];
export const POOL = ['carry', 'next', 'later', 'icebox', 'proposed'];
const TEMPLATE = '## What ships\n\n## Risks\n\n## Milestones\n\n## Updates\n';   // what a new page starts with: the headings the planner reads, and a place for milestones
export const section = (name, ...kids) => h('div', { class: 'stack' }, h('div', { class: 'lbl' }, name), ...kids);
export const prop = (name, el) => h('div', { class: 'prop' }, h('div', { class: 'prop-name' }, name), h('div', { class: 'prop-val' }, el));
export const sel = (list, value, onChange, label) => h('select', { class: 'pfield', 'aria-label': label, onChange: e => onChange(e.target.value) }, opts(list, value));
export const txt = (value, onChange, label, ph = 'Empty') => h('input', { class: 'pfield', value, 'aria-label': label, placeholder: ph, onChange: e => onChange(e.target.value) });

export function drawer(id) {
  const i = items().find(x => x.id === id), d = D();
  const shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close detail', onClick: () => openIt(null) }), h('aside', { class: 'drawer' }, ...kids));
  if (!i) return shell(h('div', { class: 'hrow between' }, h('b', {}, 'Initiative not found'), h('button', { class: 'btn sm', onClick: () => openIt(null) }, 'Close')));
  const A = cyc(d.active), nx = cyc(d.nx), locked = nx.status !== 'planned';
  const upd = patch => act(() => api('PATCH', `/initiatives/${i.id}`, patch));
  const planLine = i.tier === 'cycle' ? `In ${A.name} (active)` : i.tier === 'plan' ? `Planned for Cycle ${i.cycle}${i.rank ? ', rank ' + i.rank : ''}` : i.tier === 'done' ? `Shipped in Cycle ${i.cycle}` : i.tier === 'carry' ? `Carried over from Cycle ${i.cycle}, not shipped` : 'Backlog, not in a cycle';
  const cycleOpts = [['', 'Backlog (no cycle)'], ...d.cycles.filter(c => c.status !== 'closed' || c.n === i.cycle).map(c => [String(c.n), `${c.name} (${c.status})`])];
  const key = `${i.id}:body`;
  prune(k => k.startsWith(i.id + ':') || k.startsWith('modal:'));   // the editors of any other initiative are taken down
  const agent = S.agents[i.id];
  const page = rich(key, i.body, (md, base) => upd({ body: md, base }), { minHeight: 280, node: i.node, idPrefix: `task:${i.project}.${i.slug}.` });
  return shell(
    h('div', { class: 'hrow between drawer-head', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('h2', { class: 'drawer-title' }, i.title),
      h('div', { class: 'hrow', style: 'gap:6px;flex-wrap:nowrap' }, h('button', { class: 'btn sm', onClick: () => openFull('initiative', i.id) }, 'Open full view ↗'), h('button', { class: 'btn sm', 'aria-label': 'Close', onClick: () => openIt(null) }, '✕ Close'))),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, chip(i.statusClass, i.statusLabel), chip('s-none', i.tierLabel), chip('s-none', i.projectTitle), i.flags.length ? chip('s-off', `${i.flags.length} check${i.flags.length > 1 ? 's' : ''}`) : null),

    h('div', { class: 'props' },
      prop('Status', sel([['', 'No status'], ...d.enums.statuses.map(s => [s, d.enums.labels[s]])], i.status, v => upd({ status: v }), 'Status')),
      prop('Champion', txt(i.owner, v => upd({ owner: v }), 'Champion', 'No champion')),
      prop('Contributors', txt(i.contributors.join(', '), v => upd({ contributors: v }), 'Contributors', 'Comma separated')),
      prop('Effort', sel([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], i.effort, v => upd({ effort: v }), 'Effort')),
      prop('Cycle', sel(cycleOpts, i.cycle == null ? '' : i.cycle, v => upd(v === '' ? { cycle: null, rank: null } : { cycle: +v, approved: true }), 'Cycle')),
      i.cycle == null ? prop('Bucket', sel(BUCKETS, i.bucket, v => upd({ bucket: v }), 'Backlog bucket')) : null,
      prop('Mission', txt(i.mission, v => upd({ mission: v }), 'Mission', 'No mission')),
      prop('Target', txt(i.target, v => upd({ target: v }), 'Target date', 'YYYY-MM-DD')),
      prop('Progress', h('div', {}, h('div', { class: 'hrow between small', style: 'flex-wrap:nowrap' }, h('span', { class: 'muted' }, i.progressBasis), h('b', {}, i.progress + '%')), bar(i.progress, i.hot))),
      i.contributors.length || i.owner ? prop('People', h('div', { class: 'hrow' }, ...[i.owner, ...i.contributors].filter(Boolean).map(n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n)))) : null),

    h('div', { class: 'page-bar' }, h('div', { class: 'lbl' }, 'Page'), h('div', { class: 'hrow', style: 'gap:4px' }, h('span', { class: 'muted small' }, 'Type / for blocks ·'),
      ...[['milestone', 'Milestone'], ['link', 'Link'], ['pr', 'PR'], ['update', 'Update']].map(([k, l]) => h('button', { class: 'btn sm', onClick: () => insertInto(key, k) }, '+ ' + l)))),
    page,

    section('Planner checks', ...i.flags.map(f => h('div', { style: 'color:#8a1c12' }, '• ' + f)), i.flags.length ? null : muted(i.tier === 'cycle' ? 'No issues found.' : 'Checks run on items in the active cycle.', 'small')),
    section('Planning', h('div', { class: 'small' }, planLine),
      h('div', { class: 'hrow' },
        h('button', { class: 'btn' + (i.approved ? ' on' : ''), onClick: () => upd({ approved: !i.approved }) }, i.approved ? 'Approved (click to revoke)' : 'Approve for planning'),
        i.approved && POOL.includes(i.tier) && !locked ? h('button', { class: 'btn pri', onClick: () => upd({ cycle: nx.n, rank: items().filter(x => x.cycle === nx.n).length + 1 }) }, `Add to ${nx.name}`) : null,
        i.tier === 'plan' && i.cycle === nx.n && !locked ? h('button', { class: 'btn', onClick: () => upd({ cycle: null, rank: null }) }, 'Remove from cycle plan') : null)),
    h('div', { class: 'hrow' }, h('button', { class: 'btn pri', onClick: () => runItemAgent(i.id) }, 'Ask status agent'),
      canSimulate(i) ? h('button', { class: 'btn', onClick: () => openSimulation(i) }, 'Simulate') : null),
    agent ? h('div', { class: 'agent' }, agent) : null,
    h('div', { class: 'muted small' }, 'Stored in the vault as ', h('code', {}, `projects/${i.project}/docs/${i.slug}.md`), ' (', h('code', {}, i.node), ').'));
}

export function modal() {
  const m = S.modal; if (!m) { prune(k => !k.startsWith('modal:')); return null; }
  const d = D(), v = m.v || (m.v = { title: '', description: '', owner: '', effort: '', mission: '', body: TEMPLATE, project: m.project || (d.projects[0] && d.projects[0].slug) || '', newProject: '' });   // kept on the dialog: it is rebuilt after every change
  const close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => {
    if (m.kind === 'project') { await api('POST', '/projects', v); S.modal = null; return; }
    let project = v.project;
    if (v.newProject.trim()) project = (await api('POST', '/projects', { title: v.newProject })).slug;
    if (!project) throw new Error('choose a project, or name a new one');
    const r = await api('POST', '/initiatives', { ...v, project });
    S.modal = null; go(route().view, r.id);
  });
  const field = (name, el, style) => h('label', { class: 'f', style }, h('span', { class: 'lbl' }, name), el);
  const input = (key, extra = {}) => h('input', { class: 'field', value: v[key], onInput: e => { v[key] = e.target.value; }, ...extra });
  return h('div', { class: 'modal' }, h('div', { class: 'card' },
    h('div', { class: 'hrow between' }, h('h3', {}, m.kind === 'project' ? 'New project' : 'New initiative'), h('button', { class: 'btn sm', onClick: close }, 'Cancel')),
    muted(m.kind === 'project' ? 'A project groups related initiatives.' : 'It lands in the backlog as proposed. Approve it on the Plan page to include it in a cycle.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    field('Title', input('title', { autofocus: true })),
    m.kind === 'initiative' ? h('div', { class: 'hrow' },
      field('Project', h('select', { class: 'field', onChange: e => { v.project = e.target.value; } }, d.projects.map(p => h('option', { value: p.slug, selected: p.slug === v.project }, p.title))), 'flex:1 1 180px'),
      field('Or a new project', input('newProject', { placeholder: 'Name' }), 'flex:1 1 180px')) : null,
    m.kind === 'initiative'
      ? [field('Page', rich('modal:body', v.body, md => { v.body = md; }, { minHeight: 200 })), h('div', { class: 'hrow' },
        field('Effort', h('select', { class: 'field', onChange: e => { v.effort = e.target.value; } }, opts([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], v.effort))),
        field('Mission', input('mission'), '1 1 140px'), field('Champion', input('owner', { placeholder: 'One name' }), '1 1 160px'))]
      : [field('Description', h('textarea', { class: 'field', style: 'min-height:70px', onInput: e => { v.description = e.target.value; } }, v.description)), field('Owner', input('owner'))],
    h('button', { class: 'btn pri', onClick: submit }, 'Create')));
}

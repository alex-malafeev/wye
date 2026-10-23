// The full view of an initiative or a project: its properties across the top, the whole page as a wide editor on the
// left, and cards that stay in view on the right (progress, checks, planning, milestones, links, updates).
import { S, h, chip, bar, muted, safeUrl, GOAL_STATUS, goalStatus, api, act, render, go, openFull, openIt, openProject, openPerson, closeFull, items, cyc, D } from './core.js';
import { rich, prune } from './rich.js';
import { sel, txt, BUCKETS, POOL, newInitiativePage, goalSel } from './drawer.js';
import { runItemAgent, itemRow, listFilters } from './views.js';
import { openSimulation, canSimulate } from './simulate.js';
import { personPicker } from './picker.js';

const fprop = (name, el) => h('div', { class: 'fprop' }, h('div', { class: 'prop-name' }, name), el);
const sideCard = (title, ...kids) => h('div', { class: 'card' }, h('div', { class: 'card-h' }, title), ...kids);
const crumbs = (parts = [], actions) => h('div', { class: 'crumbs' }, h('button', { class: 'link-btn', onClick: closeFull }, '← Back'), ...parts.flatMap(p => [h('span', { class: 'muted' }, '/'), p]), actions ? h('div', { class: 'crumb-actions' }, ...actions) : null);
const owl = () => h('img', { class: 'btn-owl', src: '/owl.svg', alt: '' });
const missing = what => h('main', { class: 'wrap' }, h('div', { class: 'panel full' }, crumbs(), h('h1', {}, `${what} not found`), muted('It may have been renamed or removed.')));

export function fullView({ kind, id }) { return kind === 'initiative' ? fullInitiative(id) : kind === 'goal' ? fullGoal(id) : fullProject(id); }

// ---- an initiative
function fullInitiative(id) {
  const i = items().find(x => x.id === id), d = D();
  if (!i) return missing('Project');
  const A = cyc(d.active), nx = cyc(d.nx), locked = nx.status !== 'planned';
  const upd = patch => act(() => api('PATCH', `/initiatives/${i.id}`, patch));
  const planLine = i.tier === 'cycle' ? `In ${A.name} (active)` : i.tier === 'plan' ? `Planned for Cycle ${i.cycle}${i.rank ? ', rank ' + i.rank : ''}` : i.tier === 'done' ? `Shipped in Cycle ${i.cycle}` : i.tier === 'carry' ? `Carried over from Cycle ${i.cycle}, not shipped` : 'Backlog, not in a cycle';
  const cycleOpts = [['', 'Backlog (no cycle)'], ...d.cycles.filter(c => c.status !== 'closed' || c.n === i.cycle).map(c => [String(c.n), `${c.name} (${c.status})`])];
  const key = `${i.id}:body`;
  prune(k => k.startsWith(i.id + ':') || k.startsWith('modal:'));
  const page = rich(key, i.body, (md, base) => upd({ body: md, base }), { minHeight: 520, node: i.node, idPrefix: `task:${i.project}.${i.slug}.`, scope: `${i.project}.${i.slug}`, project: i.project });
  return h('main', { class: 'wrap' }, h('div', { class: 'fwrap' }, h('div', { class: 'panel full' },
    crumbs([h('button', { class: 'link-btn', onClick: () => openFull('project', i.project) }, i.projectTitle), h('span', {}, i.title)],
      [canSimulate(i) ? h('button', { class: 'btn', onClick: () => openSimulation(i) }, 'Simulate') : null, h('button', { class: 'btn', onClick: () => runItemAgent(i.id) }, owl(), 'Ask status agent')]),
    h('div', { class: 'full-head' }, h('input', { class: 'full-title', value: i.title, 'aria-label': 'Title', onChange: e => upd({ title: e.target.value }) })),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, i.key ? h('span', { class: 'key-chip', title: 'Global id: #/k/' + i.key }, i.key) : null, chip(i.statusClass, i.statusLabel), chip('s-none', i.tierLabel), chip('s-none', i.projectTitle), i.flags.length ? chip('s-off', `${i.flags.length} check${i.flags.length > 1 ? 's' : ''}`) : null),
    h('div', { class: 'fmain' }, page)),
      h('aside', { class: 'panel fside' },
        sideCard('Properties', h('div', { class: 'fprops' },
      fprop('Status', sel([['', 'No status'], ...d.enums.statuses.map(s => [s, d.enums.labels[s]])], i.status, v => upd({ status: v }), 'Status')),
      fprop('Champion', personPicker({ value: i.owner, onChange: v => upd({ owner: v }), placeholder: 'No champion', label: 'Champion' })),
      fprop('Contributors', personPicker({ value: i.contributors, multi: true, onChange: v => upd({ contributors: v }), placeholder: 'No contributors', label: 'Contributors' })),
      fprop('Effort', sel([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], i.effort, v => upd({ effort: v }), 'Effort')),
      fprop('Cycle', sel(cycleOpts, i.cycle == null ? '' : i.cycle, v => upd(v === '' ? { cycle: null, rank: null } : { cycle: +v, approved: true }), 'Cycle')),
      i.cycle == null ? fprop('Bucket', sel(BUCKETS, i.bucket, v => upd({ bucket: v }), 'Backlog bucket')) : null,
      fprop('Goal', goalSel(i, upd)),
      fprop('Target', txt(i.target, v => upd({ target: v }), 'Target date', 'YYYY-MM-DD')),
      fprop('Slack', h('div', { class: 'fval' }, txt(i.slack, v => upd({ slack: v }), 'Slack channel link', 'https://…slack.com/archives/…'), i.slack ? h('a', { class: 'small', href: safeUrl(i.slack), target: '_blank', rel: 'noopener noreferrer' }, 'Open the channel ↗') : null)),
      fprop('Progress', h('div', { class: 'fval' }, h('div', { class: 'fval-line' }, h('b', {}, i.progress + '%'), h('span', { class: 'muted small' }, i.progressBasis)), bar(i.progress, i.hot))),
      fprop('Checks', h('div', { class: 'fval' }, ...i.flags.map(f => h('div', { class: 'check' }, '• ' + f)), i.flags.length ? null : muted(i.tier === 'cycle' ? 'No issues found.' : 'Run on items in the active cycle.', 'small'))),
      fprop('Approval', sel([['draft', 'Draft'], ['approved', 'Approved']], i.approved ? 'approved' : 'draft', v => upd({ approved: v === 'approved' }), 'Approval')),
      fprop('Planning', h('div', { class: 'fval' }, muted(planLine, 'small'), h('div', { class: 'hrow' },
        i.approved && POOL.includes(i.tier) && !locked ? h('button', { class: 'btn sm pri', onClick: () => upd({ cycle: nx.n, rank: items().filter(x => x.cycle === nx.n).length + 1 }) }, `Add to ${nx.name}`) : null,
        i.tier === 'plan' && i.cycle === nx.n && !locked ? h('button', { class: 'btn sm', onClick: () => upd({ cycle: null, rank: null }) }, 'Remove from plan') : null)))
    )),
        sideCard(`History (${i.log.length})`, h('div', { class: 'history' }, ...i.log.slice(0, 30).map(l => h('button', { class: 'hist-row', onClick: () => { S.modal = { kind: 'update', entry: l, item: i }; render(); } },
          h('span', { class: 'hist-dot', 'aria-hidden': 'true' }), h('span', { class: 'hist-main' }, h('span', { class: 'hist-text' }, l.text), h('span', { class: 'muted small' }, `${l.source || 'manual'} · ${l.ts.replace('T', ' ').replace('Z', '')}`)))),
          i.log.length ? null : muted('Nothing logged yet. Updates that come in from other systems, or that you add to the page, are listed here.', 'small'))),)));
}

// ---- a project
function fullProject(slug) {
  const p = D().projects.find(x => x.slug === slug);
  if (!p) return missing('Area');
  const upd = patch => act(() => api('PATCH', `/projects/${p.slug}`, patch));
  const mine = items().filter(i => i.project === p.slug), cy = mine.filter(i => i.tier === 'cycle');
  const flt = listFilters(`area:${p.slug}`, mine);
  const avg = cy.length ? Math.round(cy.reduce((s, i) => s + i.progress, 0) / cy.length) : 0;
  const mix = {}; mine.forEach(i => { mix[i.statusLabel] = (mix[i.statusLabel] || 0) + 1; });
  const people = [...new Set(mine.flatMap(i => [i.owner, ...i.contributors]).filter(Boolean))];
  const key = `project:${p.slug}:body`;
  prune(k => k.startsWith(`project:${p.slug}:`) || k.startsWith('modal:'));
  const page = rich(key, p.body, (md, base) => upd({ body: md, base }), { minHeight: 56, kinds: ['link', 'update'], scope: `${p.slug}`, project: p.slug });
  return h('main', { class: 'wrap' }, h('div', { class: 'fwrap' }, h('div', { class: 'panel full' },
    crumbs([h('button', { class: 'link-btn', onClick: () => go('projects') }, 'Projects'), h('span', {}, p.title)],
      [h('button', { class: 'btn', onClick: () => newInitiativePage(p.slug) }, '+ New project')]),
    h('div', { class: 'full-head' }, h('input', { class: 'full-title', value: p.title, 'aria-label': 'Area name', onChange: e => upd({ title: e.target.value }) })),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, chip('s-none', `${mine.length} project${mine.length === 1 ? '' : 's'}`), chip('s-none', `${cy.length} in the active cycle`), ...Object.entries(mix).map(([l, n]) => chip('s-none', `${n} ${l.toLowerCase()}`))),
    h('div', { class: 'fmain' }, page,
      h('div', { class: 'fsec' }, h('div', { class: 'fsec-h hrow between' }, flt.active ? `Projects (${flt.shown.length} of ${mine.length})` : `Projects (${mine.length})`, flt.icon), flt.panel,
        h('div', { class: 'mini-list' }, ...flt.shown.map(it => itemRow(it, `${it.owner || 'No champion'} · ${it.cycle == null ? it.tierLabel : 'Cycle ' + it.cycle}${it.effort ? ' · ' + it.effort : ''}`)), mine.length ? (flt.shown.length ? null : muted('Nothing matches these filters.', 'small')) : muted('No projects yet. Use + New project.', 'small'))))),
      h('aside', { class: 'panel fside' },
        sideCard('Properties', h('div', { class: 'fprops' }, fprop('Owner', personPicker({ value: p.owner, onChange: v => upd({ owner: v }), placeholder: 'No owner', label: 'Owner' })),
          fprop('Progress', h('div', { class: 'fval' }, h('div', { class: 'fval-line' }, h('b', {}, avg + '%'), h('span', { class: 'muted small' }, 'Average of the active cycle')), bar(avg, cy.some(i => i.status === 'off-track')))))),
        sideCard('Links', ...p.links.map(l => h('a', { class: 'side-link', href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, l.label + ' ↗')), p.links.length ? null : muted('None yet. Add one with + Link.', 'small')),
        people.length ? sideCard('People', h('div', { class: 'hrow' }, ...people.map(n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n)))) : null)));
}

// ---- a goal: what is worked towards, its page, and the projects under it
function fullGoal(slug) {
  const g = (D().goals || []).find(x => x.slug === slug);
  if (!g) return missing('Goal');
  const upd = patch => act(() => api('PATCH', `/goals/${g.slug}`, patch));
  const mine = items().filter(i => i.goal === g.slug), flt = listFilters(`goal:${g.slug}`, items().filter(i => i.goal === g.slug)), [, label, cls] = goalStatus(g.status), key = `goal:${g.slug}:body`;
  prune(k => k.startsWith(`goal:${g.slug}:`) || k.startsWith('modal:'));
  const page = rich(key, g.body, md => upd({ body: md }), { minHeight: 56, kinds: ['link', 'update'], scope: `goal-${g.slug}`, project: '' });
  const remove = () => { if (window.confirm(`Delete the goal "${g.title}"? Its page is removed; projects must be moved first.`)) act(async () => { await api('DELETE', `/goals/${g.slug}`); go('goals'); }); };
  return h('main', { class: 'wrap' }, h('div', { class: 'fwrap' }, h('div', { class: 'panel full' },
    crumbs([h('button', { class: 'link-btn', onClick: () => go('goals') }, 'Goals'), h('span', {}, g.title)], [h('button', { class: 'btn', onClick: remove }, 'Delete goal')]),
    h('div', { class: 'full-head' }, h('input', { class: 'full-title', value: g.title, 'aria-label': 'Goal title', onChange: e => upd({ title: e.target.value }) })),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, h('span', { class: 'key-chip', title: 'Global id: #/k/' + g.key }, g.key), chip(cls, label), chip('s-none', `${mine.length} project${mine.length === 1 ? '' : 's'}`)),
    h('div', { class: 'fmain' }, page,
      h('div', { class: 'fsec' }, h('div', { class: 'fsec-h hrow between' }, flt.active ? `Projects (${flt.shown.length} of ${mine.length})` : `Projects (${mine.length})`, flt.icon), flt.panel,
        h('div', { class: 'mini-list' }, ...flt.shown.map(it => itemRow(it)), mine.length ? (flt.shown.length ? null : muted('Nothing matches these filters.', 'small')) : muted('No projects under this goal yet. Set the Goal on a project to put it here.', 'small'))))),
    h('aside', { class: 'panel fside' },
      sideCard('Properties', h('div', { class: 'fprops' },
        fprop('Status', sel(GOAL_STATUS.map(x => [x[0], x[1]]), g.status, v => upd({ status: v }), 'Status')),
        fprop('Owner', personPicker({ value: g.owner, onChange: v => upd({ owner: v }), placeholder: 'No owner', label: 'Owner' })),
        fprop('Target', txt(g.target, v => upd({ target: v }), 'Target date', 'YYYY-MM-DD')),
        fprop('Slack', h('div', { class: 'fval' }, txt(g.slack, v => upd({ slack: v }), 'Slack channel link', 'https://…slack.com/archives/…'), g.slack ? h('a', { class: 'small', href: safeUrl(g.slack), target: '_blank', rel: 'noopener noreferrer' }, 'Open the channel ↗') : null)),
        fprop('Progress', h('div', { class: 'fval' }, h('div', { class: 'fval-line' }, h('b', {}, g.progress + '%'), h('span', { class: 'muted small' }, g.basis)), bar(g.progress, g.hot))))),
      sideCard('Links', ...g.links.map(l => h('a', { class: 'side-link', href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, l.label + ' ↗')), g.links.length ? null : muted('None yet. Add one with /link in the page.', 'small')))));
}

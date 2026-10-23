// The initiative drawer — a property sheet over one page, like a Notion or Wye page — and the two "new" dialogs.
import { S, h, chip, bar, muted, opts, api, act, render, go, route, openIt, openFull, openPerson, items, cyc, D } from './core.js';
import { runItemAgent, runPortfolio } from './views.js';
import { rich, prune } from './rich.js';
import { openSimulation, canSimulate } from './simulate.js';
import { personPicker } from './picker.js';
import { safeUrl } from './core.js';

export const BUCKETS = [['proposed', 'Proposed'], ['next', 'Next cycle'], ['later', 'Later'], ['icebox', 'Icebox']];
export const POOL = ['carry', 'next', 'later', 'icebox', 'proposed'];
const TEMPLATE = '## What ships\n\n## Milestones\n\n## Updates\n';   // what a new page starts with: the headings the planner reads, and a place for milestones
export const section = (name, ...kids) => h('div', { class: 'stack' }, h('div', { class: 'lbl' }, name), ...kids);
export const prop = (name, el) => h('div', { class: 'prop' }, h('div', { class: 'prop-name' }, name), h('div', { class: 'prop-val' }, el));
// a project's goal: a choice among the goals, with a way to its page
export const goalSel = (i, upd) => h('div', { class: 'stack', style: 'gap:2px' }, sel([['', 'No goal'], ...(D().goals || []).map(g => [g.slug, g.title])], i.goal || '', v => upd({ goal: v }), 'Goal'),
  i.goal ? h('button', { class: 'link-btn small', style: 'text-align:left', onClick: () => openFull('goal', i.goal) }, 'Open the goal ↗') : null);
export const sel = (list, value, onChange, label) => h('select', { class: 'pfield', 'aria-label': label, onChange: e => onChange(e.target.value) }, opts(list, value));
export const txt = (value, onChange, label, ph = 'Empty') => h('input', { class: 'pfield', value, 'aria-label': label, placeholder: ph, onChange: e => onChange(e.target.value) });

export function drawer(id) {
  const i = items().find(x => x.id === id), d = D();
  const shell = (...kids) => h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close detail', onClick: () => openIt(null) }), h('aside', { class: 'drawer' }, ...kids));
  if (!i) return shell(h('div', { class: 'hrow between' }, h('b', {}, 'Project not found'), h('button', { class: 'btn sm', onClick: () => openIt(null) }, 'Close')));
  const A = cyc(d.active), nx = cyc(d.nx), locked = nx.status !== 'planned';
  const upd = patch => act(() => api('PATCH', `/initiatives/${i.id}`, patch));
  const planLine = i.tier === 'cycle' ? `In ${A.name} (active)` : i.tier === 'plan' ? `Planned for Cycle ${i.cycle}${i.rank ? ', rank ' + i.rank : ''}` : i.tier === 'done' ? `Shipped in Cycle ${i.cycle}` : i.tier === 'carry' ? `Carried over from Cycle ${i.cycle}, not shipped` : 'Backlog, not in a cycle';
  const cycleOpts = [['', 'Backlog (no cycle)'], ...d.cycles.filter(c => c.status !== 'closed' || c.n === i.cycle).map(c => [String(c.n), `${c.name} (${c.status})`])];
  const key = `${i.id}:body`;
  prune(k => k.startsWith(i.id + ':') || k.startsWith('modal:'));   // the editors of any other initiative are taken down
  const page = rich(key, i.body, (md, base) => upd({ body: md, base }), { minHeight: 280, node: i.node, idPrefix: `task:${i.project}.${i.slug}.`, scope: `${i.project}.${i.slug}`, project: i.project });
  return shell(
    h('div', { class: 'hrow between drawer-head', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('h2', { class: 'drawer-title' }, i.title),
      h('div', { class: 'hrow', style: 'gap:6px;flex-wrap:nowrap' }, h('button', { class: 'btn sm', onClick: () => openFull('initiative', i.id) }, 'Open full view ↗'), h('button', { class: 'btn sm', 'aria-label': 'Close', onClick: () => openIt(null) }, '✕ Close'))),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, chip(i.statusClass, i.statusLabel), chip('s-none', i.tierLabel), chip('s-none', i.projectTitle), i.flags.length ? chip('s-off', `${i.flags.length} check${i.flags.length > 1 ? 's' : ''}`) : null),

    h('div', { class: 'props' },
      prop('Status', sel([['', 'No status'], ...d.enums.statuses.map(s => [s, d.enums.labels[s]])], i.status, v => upd({ status: v }), 'Status')),
      prop('Champion', personPicker({ value: i.owner, onChange: v => upd({ owner: v }), placeholder: 'No champion', label: 'Champion' })),
      prop('Contributors', personPicker({ value: i.contributors, multi: true, onChange: v => upd({ contributors: v }), placeholder: 'No contributors', label: 'Contributors' })),
      prop('Effort', sel([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], i.effort, v => upd({ effort: v }), 'Effort')),
      prop('Cycle', sel(cycleOpts, i.cycle == null ? '' : i.cycle, v => upd(v === '' ? { cycle: null, rank: null } : { cycle: +v, approved: true }), 'Cycle')),
      i.cycle == null ? prop('Bucket', sel(BUCKETS, i.bucket, v => upd({ bucket: v }), 'Backlog bucket')) : null,
      prop('Goal', goalSel(i, upd)),
      prop('Target', txt(i.target, v => upd({ target: v }), 'Target date', 'YYYY-MM-DD')),
      prop('Slack', h('div', { class: 'stack', style: 'gap:2px' }, txt(i.slack, v => upd({ slack: v }), 'Slack channel link', 'https://…slack.com/archives/…'), i.slack ? h('a', { class: 'small', href: safeUrl(i.slack), target: '_blank', rel: 'noopener noreferrer' }, 'Open the channel ↗') : null)),
      prop('Progress', h('div', {}, h('div', { class: 'hrow between small', style: 'flex-wrap:nowrap' }, h('span', { class: 'muted' }, i.progressBasis), h('b', {}, i.progress + '%')), bar(i.progress, i.hot))),
      i.contributors.length || i.owner ? prop('People', h('div', { class: 'hrow' }, ...[i.owner, ...i.contributors].filter(Boolean).map(n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n)))) : null),

    page,

    section('Planner checks', ...i.flags.map(f => h('div', { style: 'color:#8a1c12' }, '• ' + f)), i.flags.length ? null : muted(i.tier === 'cycle' ? 'No issues found.' : 'Checks run on items in the active cycle.', 'small')),
    section('Planning', h('div', { class: 'small' }, planLine),
      h('div', { class: 'hrow' },
        h('button', { class: 'btn' + (i.approved ? ' on' : ''), onClick: () => upd({ approved: !i.approved }) }, i.approved ? 'Approved (click to revoke)' : 'Approve for planning'),
        i.approved && POOL.includes(i.tier) && !locked ? h('button', { class: 'btn pri', onClick: () => upd({ cycle: nx.n, rank: items().filter(x => x.cycle === nx.n).length + 1 }) }, `Add to ${nx.name}`) : null,
        i.tier === 'plan' && i.cycle === nx.n && !locked ? h('button', { class: 'btn', onClick: () => upd({ cycle: null, rank: null }) }, 'Remove from cycle plan') : null)),
    h('div', { class: 'hrow' }, h('button', { class: 'btn pri', onClick: () => runItemAgent(i.id) }, 'Ask status agent'),
      canSimulate(i) ? h('button', { class: 'btn', onClick: () => openSimulation(i) }, 'Simulate') : null),
    h('div', { class: 'muted small' }, 'Stored in the vault as ', h('code', {}, `areas/${i.project}/docs/${i.slug}.md`), ' (', h('code', {}, i.node), ').'));
}

export function modal() {
  const m = S.modal; if (!m) { prune(k => !k.startsWith('modal:')); return null; }
  if (m.kind === 'person') return personModal(m);
  if (m.kind === 'type') return typeModal(m);
  if (m.kind === 'update') return updateDrawer(m);
  if (m.kind === 'goal') return goalModal(m);
  if (m.kind === 'agent') return agentDrawer(m);
  const d = D(), v = m.v || (m.v = { title: '', description: '', owner: '', effort: '', goal: '', body: TEMPLATE, project: m.project || (d.projects[0] && d.projects[0].slug) || '', newProject: '' });   // kept on the dialog: it is rebuilt after every change
  const close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => {
    if (m.kind === 'project') { await api('POST', '/projects', v); S.modal = null; return; }
    let project = v.project;
    if (v.newProject.trim()) project = (await api('POST', '/projects', { title: v.newProject })).slug;
    if (!project) throw new Error('choose an area, or name a new one');
    const r = await api('POST', '/initiatives', { ...v, project });
    S.modal = null; go(route().view, r.id);
  });
  const field = (name, el, style) => h('label', { class: 'f', style }, h('span', { class: 'lbl' }, name), el);
  const input = (key, extra = {}) => h('input', { class: 'field', value: v[key], onInput: e => { v[key] = e.target.value; }, ...extra });
  return h('div', { class: 'modal' }, h('div', { class: 'card' },
    h('div', { class: 'hrow between' }, h('h3', {}, m.kind === 'project' ? 'New area' : 'New project'), h('button', { class: 'btn sm', onClick: close }, 'Cancel')),
    muted(m.kind === 'project' ? 'An area groups related projects.' : 'It lands in the backlog as proposed. Approve it on the Plan page to include it in a cycle.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    field('Title', input('title', { autofocus: true })),
    m.kind === 'initiative' ? h('div', { class: 'hrow' },
      field('Area', h('select', { class: 'field', onChange: e => { v.project = e.target.value; } }, d.projects.map(p => h('option', { value: p.slug, selected: p.slug === v.project }, p.title))), 'flex:1 1 180px'),
      field('Or a new area', input('newProject', { placeholder: 'Name' }), 'flex:1 1 180px')) : null,
    m.kind === 'initiative'
      ? [field('Page', rich('modal:body', v.body, md => { v.body = md; }, { minHeight: 200, scope: 'new' })), h('div', { class: 'hrow' },
        field('Effort', h('select', { class: 'field', onChange: e => { v.effort = e.target.value; } }, opts([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], v.effort))),
        field('Goal', h('select', { class: 'field', onChange: e => { v.goal = e.target.value; } }, opts([['', 'No goal'], ...(d.goals || []).map(g => [g.slug, g.title])], v.goal)), '1 1 140px'), h('label', { class: 'f', style: 'flex:1 1 200px' }, h('span', { class: 'lbl' }, 'Champion'), personPicker({ value: v.owner, onChange: n => { v.owner = n; render(); }, placeholder: 'Start typing a name', label: 'Champion' })))]
      : [field('Description', h('textarea', { class: 'field', style: 'min-height:70px', onInput: e => { v.description = e.target.value; } }, v.description)), h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Owner'), personPicker({ value: v.owner, onChange: n => { v.owner = n; }, placeholder: 'No owner', label: 'Owner' }))],
    h('button', { class: 'btn pri', onClick: submit }, 'Create')));
}

// A person is added by hand for now; they get a page in the vault, with a source, so a sync can fill the same pages later.
function personModal(m) {
  const v = m.v || (m.v = { name: '', role: '', team: '', email: '' }), teams = [...new Set(D().people.map(p => p.team).filter(Boolean))];
  const close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => { const p = await api('POST', '/people', v); S.selP = p.name; S.modal = null; go('people'); });
  const field = (name, key, ph, extra = {}) => h('label', { class: 'f' }, h('span', { class: 'lbl' }, name), h('input', { class: 'field', value: v[key], placeholder: ph, onInput: e => { v[key] = e.target.value; }, ...extra }));
  return h('div', { class: 'modal' }, h('form', { class: 'card', onSubmit: e => { e.preventDefault(); submit(); } },
    h('div', { class: 'hrow between' }, h('h3', {}, 'New person'), h('button', { class: 'btn sm', type: 'button', onClick: close }, 'Cancel')),
    muted('Added by hand for now. When people come from the company directory they will appear here on their own, with the same fields.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    field('Name', 'name', 'As it is written on projects', { autofocus: true }),
    h('div', { class: 'hrow' }, h('div', { style: 'flex:1 1 200px' }, field('Role', 'role', 'e.g. Staff engineer')), h('div', { style: 'flex:1 1 200px' }, field('Team', 'team', 'e.g. Data foundations', { list: 'person-teams' }))),
    h('datalist', { id: 'person-teams' }, ...teams.map(t => h('option', { value: t }))),
    field('Email', 'email', 'name@company.com', { type: 'email' }),
    h('button', { class: 'btn pri', type: 'submit' }, 'Add person')));
}

// A type a person defines: a name, its statuses and its fields. It becomes a Wye type card in the vault, and an
// instance of it is a block anywhere in a page.
function typeModal(m) {
  const kinds = D().fieldKinds, v = m.v || (m.v = { key: '', name: '', plural: '', purpose: '', statuses: 'open, done', fields: [] });
  const close = () => { S.modal = null; S.err = ''; render(); };
  const payload = () => ({ key: v.key, name: v.name, plural: v.plural, purpose: v.purpose, statuses: v.statuses, fields: v.fields.filter(f => f.name.trim()).map(f => ({ ...f, options: f.kind === 'choice' ? f.options : undefined })) });
  const submit = () => act(async () => { await api(m.slug ? 'PUT' : 'POST', m.slug ? `/types/${m.slug}` : '/types', payload()); S.modal = null; });
  const field = (name, key, ph, extra = {}) => h('label', { class: 'f' }, h('span', { class: 'lbl' }, name), h('input', { class: 'field', value: v[key], placeholder: ph, onInput: e => { v[key] = e.target.value; }, ...extra }));
  return h('div', { class: 'modal' }, h('form', { class: 'card', onSubmit: e => { e.preventDefault(); submit(); } },
    h('div', { class: 'hrow between' }, h('h3', {}, m.slug ? `Edit ${v.name}` : 'New type'), h('button', { class: 'btn sm', type: 'button', onClick: close }, 'Cancel')),
    muted('A type is a kind of thing you keep in pages. Once it exists, "/" offers it, and each one you add is a node Wye can query.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'hrow' }, h('div', { style: 'flex:1 1 200px' }, field('Name', 'name', 'e.g. Risk', { autofocus: !m.slug, disabled: !!m.slug })), h('div', { style: 'flex:1 1 200px' }, field('Plural', 'plural', 'e.g. Risks'))),
    field('Key', 'key', 'ids look like ASK-12; leave empty to derive it from the name', { disabled: !!m.slug, maxlength: 6, style: 'text-transform:uppercase' }),
    field('What it is', 'purpose', 'e.g. Something that could go wrong'),
    field('Statuses', 'statuses', 'open, mitigated, closed (the first is the one a new one starts in)'),
    h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Fields'),
      ...v.fields.map((f, k) => h('div', { class: 'hrow', style: 'flex-wrap:nowrap' },
        h('input', { class: 'field', style: 'flex:1 1 150px', value: f.name, placeholder: 'name, e.g. severity', 'aria-label': 'Field name', onInput: e => { f.name = e.target.value; } }),
        h('select', { class: 'field', 'aria-label': 'Kind of field', onChange: e => { f.kind = e.target.value; render(); } }, opts(kinds, f.kind)),
        f.kind === 'choice' ? h('input', { class: 'field', style: 'flex:1 1 150px', value: f.options, placeholder: 'low, medium, high', 'aria-label': 'Options', onInput: e => { f.options = e.target.value; } }) : null,
        h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Remove field', onClick: () => { v.fields.splice(k, 1); render(); } }, '✕'))),
      h('div', {}, h('button', { class: 'btn sm', type: 'button', onClick: () => { v.fields.push({ name: '', kind: 'text', options: '' }); render(); } }, '+ Add field'))),
    h('button', { class: 'btn pri', type: 'submit' }, m.slug ? 'Save' : 'Create type')));
}

// One entry of an initiative's history: what came in, who or what sent it, when, and where it belongs.
const stamped = ts => String(ts || '').replace('T', ' ').replace('Z', ' UTC');
const linked = text => String(text).split(/(https?:\/\/[^\s)]+)/g).map((p, k) => (k % 2 ? h('a', { href: safeUrl(p), target: '_blank', rel: 'noopener noreferrer' }, p) : p));
function updateDrawer(m) {
  const l = m.entry, close = () => { S.modal = null; render(); };
  const row = (k, v) => h('div', { class: 'info-row' }, h('div', { class: 'prop-name' }, k), h('div', {}, v));
  return h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close', onClick: close }),
    h('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Update' },
      h('div', { class: 'hrow between' }, h('div', { class: 'hrow' }, chip('s-none', 'Update'), chip('s-ns', l.source || 'manual')), h('button', { class: 'btn', 'aria-label': 'Close', onClick: close }, '✕ Close')),
      h('div', { class: 'muted small' }, stamped(l.ts)),
      h('div', { class: 'upd-text' }, ...linked(l.text)),
      h('div', { class: 'stack info' },
        row('Source', l.source || 'manual'), row('Received', stamped(l.ts)),
        row('Project', h('button', { class: 'link-btn', onClick: () => { S.modal = null; openIt(m.item.id); } }, m.item.title)),
        row('Area', m.item.projectTitle))));
}

// The status agent's answer: its own drawer, with the light Markdown it writes (bold, bullets) shown as such.
const inline = t => String(t).split(/(\*\*[^*]+\*\*)/g).map(p => (/^\*\*[^*]+\*\*$/.test(p) ? h('b', {}, p.slice(2, -2)) : p));
function mdLite(text) {
  const out = []; let list = null;
  for (const line of String(text).split('\n')) {
    const li = /^\s*[-*] (.*)$/.exec(line);
    if (li) { if (!list) out.push(list = h('ul', {})); list.append(h('li', {}, ...inline(li[1]))); continue; }
    list = null;
    if (line.trim()) out.push(h('p', {}, ...inline(line)));
  }
  return out;
}
function agentDrawer(m) {
  const i = m.id ? items().find(x => x.id === m.id) : null, text = m.portfolio ? S.portfolio.text : S.agents[m.id] || '', close = () => { S.modal = null; render(); };
  const busy = text === 'Thinking…';
  return h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close', onClick: close }),
    h('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Status agent' },
      h('div', { class: 'hrow between' }, h('div', { class: 'hrow' }, h('img', { class: 'btn-owl', src: '/owl.svg', alt: '' }), h('b', {}, m.portfolio ? 'Portfolio status agent' : 'Status agent')), h('button', { class: 'btn', 'aria-label': 'Close', onClick: close }, '✕ Close')),
      i ? h('div', { class: 'stack' }, h('h2', { class: 'drawer-title' }, i.title), h('div', { class: 'muted small' }, `${i.projectTitle} · ${i.statusLabel}`)) : h('div', { class: 'muted small' }, `Deterministic checks ran on ${items().filter(x => x.tier === 'cycle' && x.flags.length).length} flagged items. The briefing is written by Claude from those flags.`),
      busy ? h('div', { class: 'muted' }, 'Thinking…') : h('div', { class: 'agent-text' }, ...mdLite(text)),
      h('div', { class: 'hrow' }, h('button', { class: 'btn', disabled: busy, onClick: () => (m.portfolio ? runPortfolio() : runItemAgent(m.id)) }, 'Ask again'))));
}

// A new initiative is a page from the start: created at once in the project, opened full-page with its title ready to
// type over. Naming it is just editing the title; there is no dialog to fill in first.
export async function newInitiativePage(project) {
  const p = project || (D().projects[0] && D().projects[0].slug);
  if (!p) { S.modal = { kind: 'project' }; S.err = ''; render(); return; }                       // nothing to put it in yet
  await act(async () => { const r = await api('POST', '/initiatives', { project: p, title: 'Untitled project', body: TEMPLATE }); S.focusTitle = true; openFull('initiative', r.id); });
}

// A new goal: a title, who owns it, by when, and what it is. It is a page of its own afterwards.
function goalModal(m) {
  const v = m.v || (m.v = { title: '', owner: '', target: '', description: '' }), close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => { const g = await api('POST', '/goals', v); S.modal = null; openFull('goal', g.slug); });
  const field = (name, el) => h('label', { class: 'f' }, h('span', { class: 'lbl' }, name), el);
  return h('div', { class: 'modal' }, h('form', { class: 'card', onSubmit: e => { e.preventDefault(); submit(); } },
    h('div', { class: 'hrow between' }, h('h3', {}, 'New goal'), h('button', { class: 'btn sm', type: 'button', onClick: close }, 'Cancel')),
    muted('A goal is what projects work towards. Put projects under it from their Goal property.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    field('Title', h('input', { class: 'field', value: v.title, autofocus: true, placeholder: 'e.g. Grow self-serve', onInput: e => { v.title = e.target.value; } })),
    h('div', { class: 'hrow' }, h('div', { style: 'flex:1 1 200px' }, field('Owner', personPicker({ value: v.owner, onChange: n => { v.owner = n; }, placeholder: 'No owner', label: 'Owner' }))),
      h('div', { style: 'flex:1 1 160px' }, field('Target date', h('input', { class: 'field', value: v.target, placeholder: 'YYYY-MM-DD', onInput: e => { v.target = e.target.value; } })))),
    field('What it is', h('textarea', { class: 'field', style: 'min-height:70px', onInput: e => { v.description = e.target.value; } }, v.description)),
    h('button', { class: 'btn pri', type: 'submit' }, 'Create goal')));
}

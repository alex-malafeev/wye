// The initiative detail drawer and the two "new" dialogs.
import { S, h, chip, bar, muted, label, opts, safeUrl, api, act, render, go, route, openIt, openPerson, items, cyc, D } from './core.js';
import { runItemAgent } from './views.js';

const BUCKETS = [['proposed', 'Proposed'], ['next', 'Next cycle'], ['later', 'Later'], ['icebox', 'Icebox']];
const POOL = ['carry', 'next', 'later', 'icebox', 'proposed'];
const TASK_LABEL = { todo: 'Not started', 'in-progress': 'In progress', blocked: 'Blocked', review: 'In review', done: 'Done' };
const TASK_CLASS = { done: 's-on', 'in-progress': 's-ship', blocked: 's-off', review: 's-risk', todo: 's-ns' };
const section = (name, ...kids) => h('div', { class: 'stack' }, h('div', { class: 'lbl' }, name), ...kids);

export function drawer(id) {
  const i = items().find(x => x.id === id), d = D();
  if (!i) return h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close detail', onClick: () => openIt(null) }), h('aside', { class: 'drawer' }, h('div', { class: 'hrow between' }, h('b', {}, 'Initiative not found'), h('button', { class: 'btn sm', onClick: () => openIt(null) }, 'Close'))));
  const A = cyc(d.active), nx = cyc(d.nx), locked = nx.status !== 'planned', byId = i.id;
  const upd = patch => act(() => api('PATCH', `/initiatives/${byId}`, patch));
  const base = `/initiatives/${byId}`, tpath = t => `${base}/tasks/${encodeURIComponent(t.id)}`;
  const v = { ms: '', msDue: '', msOwner: '', up: '', prUrl: '', prTitle: '', lLabel: '', lUrl: '' };
  const input = (key, ph, style, aria) => h('input', { class: 'field', style, 'aria-label': aria || ph, placeholder: ph, onInput: e => { v[key] = e.target.value; } });
  const planLine = i.tier === 'cycle' ? `In ${A.name} (active)` : i.tier === 'plan' ? `Planned for Cycle ${i.cycle}${i.rank ? ', rank ' + i.rank : ''}` : i.tier === 'done' ? `Shipped in Cycle ${i.cycle}` : i.tier === 'carry' ? `Carried over from Cycle ${i.cycle}, not shipped` : 'Backlog, not in a cycle';
  const cycleOpts = [['', 'Backlog (no cycle)'], ...d.cycles.filter(c => c.status !== 'closed' || c.n === i.cycle).map(c => [String(c.n), `${c.name} (${c.status})`])];
  const text = (name, key, rows) => section(name, h('textarea', { class: 'field', style: `min-height:${rows * 22}px`, onChange: e => upd({ [key]: e.target.value }) }, i[key]));
  const agent = S.agents[i.id];
  return h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close detail', onClick: () => openIt(null) }),
    h('aside', { class: 'drawer' },
      h('div', { class: 'hrow between', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('h2', { style: 'font-size:18px' }, i.title), h('button', { class: 'btn sm', onClick: () => openIt(null) }, 'Close')),
      S.err ? h('div', { class: 'err' }, S.err) : null,
      h('div', { class: 'hrow' }, chip(i.statusClass, i.statusLabel), chip('s-none', i.tierLabel), chip('s-none', 'Effort ' + (i.effort || 'unsized')), chip('s-none', i.mission || 'No mission'), chip('s-none', i.projectTitle)),
      h('div', { class: 'hrow' },
        label('Status', h('select', { class: 'field', onChange: e => upd({ status: e.target.value }) }, opts([['', 'No status'], ...d.enums.statuses.map(s => [s, d.enums.labels[s]])], i.status))),
        label('Effort', h('select', { class: 'field', onChange: e => upd({ effort: e.target.value }) }, opts([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], i.effort))),
        label('Cycle', h('select', { class: 'field', onChange: e => upd(e.target.value === '' ? { cycle: null, rank: null } : { cycle: +e.target.value, approved: true }) }, opts(cycleOpts, i.cycle == null ? '' : i.cycle))),
        i.cycle == null ? label('Backlog bucket', h('select', { class: 'field', onChange: e => upd({ bucket: e.target.value }) }, opts(BUCKETS, i.bucket))) : null),
      h('div', { class: 'hrow' },
        label('Champion', h('input', { class: 'field', style: 'width:170px', value: i.owner, onChange: e => upd({ owner: e.target.value }) })),
        label('Contributors (comma separated)', h('input', { class: 'field', style: 'width:230px', value: i.contributors.join(', '), onChange: e => upd({ contributors: e.target.value }) })),
        label('Mission', h('input', { class: 'field', style: 'width:150px', value: i.mission, onChange: e => upd({ mission: e.target.value }) })),
        label('Target date', h('input', { class: 'field', style: 'width:140px', value: i.target, placeholder: 'YYYY-MM-DD', onChange: e => upd({ target: e.target.value }) }))),
      h('div', { class: 'hrow small' }, i.owner ? personBtn(i.owner) : muted('No champion'), ...i.contributors.map(personBtn)),
      h('div', {}, h('div', { class: 'hrow between' }, h('div', { class: 'lbl' }, 'Progress'), h('b', {}, i.progress + '%')), bar(i.progress, i.hot), h('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, i.progressBasis)),
      text('Description', 'description', 4), text('What ships', 'ships', 3), text('Dependencies / risks', 'risks', 3),

      section('Milestones',
        ...i.tasks.map(t => h('div', { class: 'hrow', style: 'flex-wrap:nowrap' },
          h('select', { class: 'field chip-select ' + TASK_CLASS[t.status], 'aria-label': 'Milestone status', onChange: e => act(() => api('PATCH', tpath(t), { status: e.target.value })) }, opts(Object.entries(TASK_LABEL), t.status)),
          h('div', { style: 'flex:1 1 auto;min-width:0' }, h('span', { style: t.status === 'done' ? 'text-decoration:line-through' : '' }, t.title), t.owner ? h('span', { class: 'muted small' }, ' · ' + t.owner) : null, t.due ? h('span', { class: 'muted', style: 'font-size:12px' }, ' · due ' + t.due) : null),
          h('button', { class: 'btn sm', 'aria-label': 'Remove milestone', onClick: () => act(() => api('DELETE', tpath(t))) }, 'Remove'))),
        i.tasks.length ? null : muted('No milestones defined yet.'),
        h('div', { class: 'hrow' }, input('ms', 'Milestone', 'flex:1 1 140px'), input('msOwner', 'Owner', 'width:110px'), input('msDue', 'Due YYYY-MM-DD', 'width:150px', 'Milestone due date'),
          h('button', { class: 'btn', onClick: () => v.ms.trim() && act(() => api('POST', `${base}/tasks`, { title: v.ms, owner: v.msOwner, due: v.msDue })) }, 'Add'))),

      section('Update log',
        h('div', { class: 'hrow' }, input('up', 'Weekly update from the champion', 'flex:1 1 200px', 'New update'), h('button', { class: 'btn', onClick: () => v.up.trim() && act(() => api('POST', `${base}/log`, { text: v.up })) }, 'Post')),
        ...i.log.map(l => h('div', { class: 'logline' }, h('div', { class: 'muted', style: 'font-size:12px' }, l.ts.replace('T', ' ').replace('Z', ''), ' · ', h('span', { class: 'source' }, l.source)), h('div', {}, l.text))),
        i.log.length ? null : muted('No updates logged.')),

      section('Pull requests',
        h('div', { class: 'hrow' }, input('prUrl', 'PR link (https://github.com/…)', 'flex:1 1 200px', 'PR link'), input('prTitle', 'Title (optional)', 'flex:1 1 140px', 'PR title'),
          h('button', { class: 'btn', onClick: () => v.prUrl.trim() && act(() => api('POST', `${base}/prs`, { url: v.prUrl, title: v.prTitle })) }, 'Add')),
        ...i.prs.map(p => linkRow(p.title, p.url, p.ts, () => act(() => api('DELETE', `${base}/prs?url=${encodeURIComponent(p.url)}`)))),
        i.prs.length ? null : muted('No PRs linked. They are added by hand, by the API, or by the GitHub webhook.')),

      section('Links',
        h('div', { class: 'hrow' }, input('lLabel', 'Label', 'flex:1 1 140px'), input('lUrl', 'https://…', 'flex:2 1 200px', 'Link URL'),
          h('button', { class: 'btn', onClick: () => v.lUrl.trim() && act(() => api('POST', `${base}/links`, { label: v.lLabel, url: v.lUrl })) }, 'Add')),
        ...i.links.map(l => linkRow(l.label, l.url, l.source, () => act(() => api('DELETE', `${base}/links?url=${encodeURIComponent(l.url)}`)))),
        i.links.length ? null : muted('No links yet.')),

      section('Planner checks', ...i.flags.map(f => h('div', { style: 'color:#8a1c12' }, '• ' + f)), i.flags.length ? null : muted(i.tier === 'cycle' ? 'No issues found.' : 'Checks run on items in the active cycle.')),

      section('Planning', h('div', {}, planLine),
        h('div', { class: 'hrow' },
          h('button', { class: 'btn' + (i.approved ? ' on' : ''), onClick: () => upd({ approved: !i.approved }) }, i.approved ? 'Approved (click to revoke)' : 'Approve for planning'),
          i.approved && POOL.includes(i.tier) && !locked ? h('button', { class: 'btn pri', onClick: () => upd({ cycle: nx.n, rank: items().filter(x => x.cycle === nx.n).length + 1 }) }, `Add to ${nx.name}`) : null,
          i.tier === 'plan' && i.cycle === nx.n && !locked ? h('button', { class: 'btn', onClick: () => upd({ cycle: null, rank: null }) }, 'Remove from cycle plan') : null)),

      h('div', { class: 'hrow' }, h('button', { class: 'btn pri', onClick: () => runItemAgent(i.id) }, 'Ask status agent'),
        h('button', { class: 'btn', onClick: () => { Object.assign(S.sim, { title: i.title, description: i.ships || i.description, result: null, text: '' }); go('sim'); } }, 'Simulate similar idea')),
      agent ? h('div', { class: 'agent' }, agent) : null,
      h('div', { class: 'muted small' }, 'Stored in the vault as ', h('code', {}, `projects/${i.project}/docs/${i.slug}.md`), ' (', h('code', {}, i.node), ').')));
}
const personBtn = n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n);
const linkRow = (label, url, meta, del) => h('div', { class: 'hrow', style: 'flex-wrap:nowrap' }, h('a', { href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer', style: 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere' }, label), h('span', { class: 'source' }, meta), h('button', { class: 'btn sm', 'aria-label': 'Remove', onClick: del }, 'Remove'));

export function modal() {
  const m = S.modal; if (!m) return null;
  const d = D(), v = { title: '', description: '', owner: '', effort: '', ships: '', mission: '', project: m.project || (d.projects[0] && d.projects[0].slug) || '', newProject: '' };
  const close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => {
    if (m.kind === 'project') { await api('POST', '/projects', v); S.modal = null; return; }
    let project = v.project;
    if (v.newProject.trim()) project = (await api('POST', '/projects', { title: v.newProject })).slug;
    if (!project) throw new Error('choose a project, or name a new one');
    const r = await api('POST', '/initiatives', { ...v, project });
    S.modal = null; go(route().view, r.id);
  });
  const text = (name, key, rows) => label(name, h('textarea', { class: 'field', style: `min-height:${rows * 22}px`, onInput: e => { v[key] = e.target.value; } }));
  return h('div', { class: 'modal' }, h('div', { class: 'card' },
    h('div', { class: 'hrow between' }, h('h3', {}, m.kind === 'project' ? 'New project' : 'New initiative'), h('button', { class: 'btn sm', onClick: close }, 'Cancel')),
    muted(m.kind === 'project' ? 'A project groups related initiatives.' : 'It lands in the backlog as proposed. Approve it on the Plan page to include it in a cycle.', 'small'),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    label('Title', h('input', { class: 'field', autofocus: true, onInput: e => { v.title = e.target.value; } })),
    m.kind === 'initiative' ? h('div', { class: 'hrow' },
      label('Project', h('select', { class: 'field', onChange: e => { v.project = e.target.value; } }, d.projects.map(p => h('option', { value: p.slug, selected: p.slug === v.project }, p.title))), 'flex:1 1 180px'),
      label('Or a new project', h('input', { class: 'field', placeholder: 'Name', onInput: e => { v.newProject = e.target.value; } }), 'flex:1 1 180px')) : null,
    text('Description', 'description', 3),
    m.kind === 'initiative' ? [text('What ships', 'ships', 3), h('div', { class: 'hrow' },
      label('Effort', h('select', { class: 'field', onChange: e => { v.effort = e.target.value; } }, opts([['', 'Unsized'], ...d.enums.efforts.map(s => [s, s])], ''))),
      label('Mission', h('input', { class: 'field', onInput: e => { v.mission = e.target.value; } }), 'flex:1 1 140px'),
      label('Champion', h('input', { class: 'field', placeholder: 'One name', onInput: e => { v.owner = e.target.value; } }), 'flex:1 1 160px'))] : label('Owner', h('input', { class: 'field', onInput: e => { v.owner = e.target.value; } })),
    h('button', { class: 'btn pri', onClick: submit }, 'Create')));
}

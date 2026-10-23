// Overview, Projects, Backlog, People and the status-agent card. (Plan, History and Settings are in plan.js.)
import { S, h, chip, bar, muted, label, opts, api, act, render, go, route, openIt, openPerson, openProject, safeUrl, items, cyc, D, fmtDate, range } from './core.js';
import { newInitiativePage } from './drawer.js';

const TIER_ORDER = { cycle: 0, plan: 1, next: 2, later: 3, icebox: 4, proposed: 5, carry: 6, done: 7 };
const STATUS_ORDER = { 'off-track': 0, 'at-risk': 1, 'on-track': 2, 'not-started': 3, paused: 4, complete: 5 };
const EFFORT_ORDER = { S: 1, M: 2, L: 3, XL: 4 };
const STATUS_LABELS = ['On Track', 'At Risk', 'Off Track', 'Not Started', 'Paused', 'Shipped', 'No status', 'Planned', 'Proposed', 'Backlog'];
const TIERS = [['', 'All tiers'], ['cycle', 'Active cycle'], ['plan', 'Planned'], ['next', 'Next cycle'], ['later', 'Later'], ['icebox', 'Icebox'], ['proposed', 'Proposed'], ['carry', 'Carry-over'], ['done', 'Shipped, past cycle']];
const DIMS = [['project', 'Project'], ['status', 'Status'], ['mission', 'Mission'], ['tier', 'Tier'], ['effort', 'Effort'], ['champion', 'Champion'], ['flag', 'Planner checks']];
const dimName = d => (DIMS.find(x => x[0] === d) || [0, 'None'])[1];
const dimVals = (it, d) => ({ project: [it.projectTitle], status: [it.statusLabel], mission: [it.mission || 'No mission'], tier: [it.tierLabel], effort: [it.effort || 'Unsized'], champion: [it.owner || 'No champion'], flag: [it.flags.length ? 'Has flags' : 'Clean'] }[d] || ['All']);
const uniq = a => [...new Set(a)].sort();

// ---- pieces several views use
export const pill = i => h('button', { class: 'pill', onClick: () => openIt(i.id) }, h('span', { class: 'chip ' + i.statusClass, style: 'margin-right:6px' }, i.statusLabel), i.title);
const personPill = n => h('button', { class: 'pill', onClick: () => openPerson(n) }, n);
export function itemRow(i, sub, selected) {
  // the layout of a project card's list: name and detail on the left; status, progress and its percentage on the right
  return h('button', { class: 'mini ranked' + (selected ? ' sel' : ''), onClick: () => openIt(i.id) },
    h('span', { class: 'mini-rank' }, i.rank == null ? '' : i.rank),   // the column is always there, so titles line up
    h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, i.title), h('span', { class: 'mini-sub' }, sub || `${i.projectTitle} · ${i.owner || 'No champion'} · ${i.tierLabel}${i.effort ? ' · ' + i.effort : ''}`)),
    h('span', { class: 'mini-chips' }, i.flags.length ? chip('s-off', `${i.flags.length} flag${i.flags.length > 1 ? 's' : ''}`) : null, chip(i.statusClass, i.statusLabel)),
    h('span', { class: 'mini-progress' }, bar(i.progress, i.hot), h('span', {}, i.progress + '%')));
}
export const smallRow = (i, why, onClick) => h('button', { class: 'row', onClick: onClick || (() => openIt(i.id)) },
  h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', { style: 'font-weight:600' }, i.title), h('div', { class: 'muted small' }, `${i.projectTitle} · ${i.owner || 'No champion'}${why ? ' · ' + why : ''}`)), chip(i.statusClass, i.statusLabel));
// rows that are items of one list: a bordered box, lines between the rows (nothing when there are none)
export const list = rows => { const r = [rows].flat(Infinity).filter(Boolean); return r.length ? h('div', { class: 'list' }, ...r) : null; };
const personRow = p => h('button', { class: 'row', onClick: () => openPerson(p.n) }, h('div', { style: 'flex:1 1 auto;font-weight:600' }, p.n), h('div', { class: 'muted', style: 'font-size:12px' }, `Load ${p.load.score} · ${p.load.c} champion, ${p.load.k} contributor`), chip(p.tagClass, p.tag));

// ---- the status agent: its answer opens in a drawer of its own (drawer.js), whatever page it was asked from
export async function runPortfolio() {
  const p = S.portfolio; p.show = true; p.text = 'Thinking…'; S.modal = { kind: 'agent', portfolio: true }; render();
  try { p.text = (await api('POST', '/agent/portfolio', {})).text; } catch (err) { p.text = err.message; }
  render();
}
export async function runItemAgent(id) {
  S.agents[id] = 'Thinking…'; S.modal = { kind: 'agent', id }; render();
  try { S.agents[id] = (await api('POST', '/agent/item', { id })).text; } catch (err) { S.agents[id] = err.message; }
  render();
}

// ---- overview
// A block of numbers, as a dashboard card: a title and what it counts, an arrow to the initiatives behind it, the
// number big at the bottom with its context.
function kpi({ title, sub, value, note, go: filter }) {
  return h('div', { class: 'card kpi', title: sub },
    h('div', { class: 'kpi-head' }, h('div', {}, h('div', { class: 'kpi-title' }, title), h('div', { class: 'kpi-sub' }, sub)),
      filter ? h('button', { class: 'kpi-open', 'aria-label': `Open ${title} in the backlog`, title: 'Open in the backlog', onClick: () => { Object.assign(S.f, { q: '', project: '', status: '', mission: '', tier: '', effort: '', champion: '', ...filter }); go('backlog'); } }, '↗') : null),
    h('div', { class: 'kpi-foot' }, h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-note' }, note || '')));
}
// why an initiative is in the side panel, in the planner's own words
const whyLines = i => {
  const l = [];
  if (i.status === 'off-track') l.push('Off track: a decision is needed.');
  if (i.status === 'at-risk') l.push('At risk: check what is in the way.');
  i.tasks.filter(t => t.status === 'blocked').forEach(t => l.push(`Blocked: ${t.title}.`));
  i.flags.filter(f => !/^(Off track|At risk)$/.test(f)).slice(0, 3).forEach(f => l.push(f + '.'));
  return l.slice(0, 4);
};

export function overview() {
  const d = D(), A = cyc(d.active), all = items(), cy = all.filter(i => i.tier === 'cycle'), n = f => cy.filter(f).length;
  const avg = cy.length ? Math.round(cy.reduce((s, i) => s + i.progress, 0) / cy.length) : 0;
  const start = new Date(A.start + 'T00:00:00Z'), end = new Date(A.end + 'T00:00:00Z'), today = new Date(d.today + 'T00:00:00Z');
  const el = Math.max(0, Math.min(100, Math.round((today - start) / ((end - start) || 1) * 100))), left = Math.max(0, Math.ceil((end - today) / 864e5));
  const past = i => i.flags.some(f => /has passed/.test(f));
  const attention = cy.filter(i => i.hot || past(i) || i.tasks.some(t => t.status === 'blocked')).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const inCycle = { tier: 'cycle' };
  const cards = [
    { title: 'Ranked items', sub: `In ${A.name}`, value: cy.length, note: `${all.length} initiatives in total`, go: inCycle },
    { title: 'On track', sub: 'Reporting on track', value: n(i => i.status === 'on-track'), note: `of ${cy.length} ranked`, go: { ...inCycle, status: 'On Track' } },
    { title: 'At risk or off track', sub: 'Needs a decision', value: n(i => i.hot), note: `of ${cy.length} ranked`, go: { ...inCycle, status: 'At Risk' } },
    { title: 'Not started', sub: `${left} days left in the cycle`, value: n(i => i.status === 'not-started'), note: `of ${cy.length} ranked`, go: { ...inCycle, status: 'Not Started' } },
    { title: 'No status', sub: 'The champion has not updated', value: n(i => !i.status), note: `of ${cy.length} ranked`, go: { ...inCycle, status: 'No status' } },
    { title: 'Shipped', sub: `In ${A.name}`, value: n(i => i.status === 'complete'), note: 'done', go: { status: 'Shipped' } },
    { title: 'Average progress', sub: 'Milestones, or an estimate', value: avg + '%', note: 'across ranked items' },
    { title: 'Planner checks', sub: 'Items with something to fix', value: n(i => i.flags.length), note: `of ${cy.length} ranked`, go: inCycle },
  ];
  return h('div', { class: 'ov' },
    h('div', { class: 'ov-main' },
      h('div', { class: 'kpis' }, cards.map(kpi)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-h' }, `${A.name} timeline`), h('div', { class: 'card-sub' }, `${el}% elapsed · ${left} days to close`)), h('div', { class: 'card-sub' }, range(A))),
        bar(el, false, true),
        h('div', { class: 'hrow between muted', style: 'font-size:12px;flex-wrap:nowrap' }, h('span', {}, fmtDate(A.start)), h('span', {}, 'Today, ' + fmtDate(d.today)), h('span', {}, fmtDate(A.end)), h('span', {}, d.config.cooldown ? `Cooldown ${d.config.cooldown} days after` : ''))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-h' }, 'Most loaded people'), h('div', { class: 'card-sub' }, 'Champion counts twice, contributor once')), h('button', { class: 'btn sm', onClick: () => go('people') }, 'All people')),
        list(d.people.slice(0, 6).map(personRow)), d.people.length ? null : muted('No people yet. Name a champion on an initiative or add a roster in People.', 'small'))),
    h('aside', { class: 'sidepanel' }, h('div', { class: 'card-h' }, 'Needs attention'),
      ...(S.attnAll ? attention : attention.slice(0, 5)).map(i => h('div', { class: 'card step clickable', role: 'button', tabIndex: 0, 'aria-label': `Open ${i.title}`, onClick: () => openIt(i.id), onKeyDown: e => { if (e.key === 'Enter') openIt(i.id); } },
        h('div', { class: 'step-title' }, h('span', { class: 'dot ' + (i.status === 'off-track' ? 'dot-off' : i.status === 'at-risk' ? 'dot-risk' : 'dot-flag'), 'aria-hidden': 'true' }), i.title),
        h('div', { class: 'step-sub' }, `${i.projectTitle} · ${i.owner || 'No champion'} · ${i.statusLabel}`),
        h('ul', { class: 'step-why' }, ...whyLines(i).map(t => h('li', {}, t))),
        )),
      attention.length > 5 ? h('button', { class: 'mini-more', onClick: () => { S.attnAll = !S.attnAll; render(); } }, S.attnAll ? 'Show fewer' : `+ ${attention.length - 5} more`) : null,
      attention.length ? null : h('div', { class: 'card step' }, h('div', { class: 'step-title' }, h('span', { class: 'dot dot-ok', 'aria-hidden': 'true' }), 'Nothing needs attention'), h('div', { class: 'step-sub' }, `Every ranked initiative in ${A.name} is on course.`))));
}

// A project's open initiatives as a compact list: name, who and when under it, status and progress at the right.
// The whole row opens the initiative; what does not fit goes behind "+ n more".
function miniList(list, more, max = 5) {
  const row = i => h('button', { class: 'mini', onClick: () => openIt(i.id) },
    h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, i.title), h('span', { class: 'mini-sub' }, `${i.owner || 'No champion'} · ${i.cycle == null ? i.tierLabel : 'Cycle ' + i.cycle}`)),
    chip(i.statusClass, i.statusLabel),
    h('span', { class: 'mini-progress' }, bar(i.progress, i.hot), h('span', {}, i.progress + '%')));
  return h('div', { class: 'mini-list' }, ...list.slice(0, max).map(row), list.length > max ? h('button', { class: 'mini-more', onClick: more }, `+ ${list.length - max} more`) : null, list.length ? null : muted('Nothing open.', 'small'));
}

// ---- projects (the planner's workstreams)
export function projects() {
  const d = D();
  return [
    h('div', { class: 'hrow' }, h('button', { class: 'btn', onClick: () => { S.modal = { kind: 'project' }; S.err = ''; render(); } }, 'New project')),
    h('div', { class: 'grid' }, d.projects.map(p => {
      const all = items().filter(i => i.project === p.slug), cy = all.filter(i => i.tier === 'cycle');
      const avg = cy.length ? Math.round(cy.reduce((s, i) => s + i.progress, 0) / cy.length) : 0;
      const mix = {}; all.forEach(i => { mix[i.statusLabel] = (mix[i.statusLabel] || 0) + 1; });
      const champs = {}; all.forEach(i => { if (i.owner) champs[i.owner] = (champs[i.owner] || 0) + 1; });
      const top = Object.keys(champs).sort((a, b) => champs[b] - champs[a]).slice(0, 4).join(', ') || 'No champions named';
      return h('div', { class: 'card' },
        h('div', { class: 'hrow between', style: 'flex-wrap:nowrap' }, h('button', { class: 'card-title', onClick: () => openProject(p.slug) }, p.title),
          h('div', { class: 'hrow', style: 'gap:8px;flex-wrap:nowrap' }, h('span', { class: 'muted small' }, `${all.length} items`), h('button', { class: 'btn sm', onClick: () => openProject(p.slug) }, 'Edit'))),
        p.description ? muted(p.description, 'small') : null,
        p.links.length ? h('div', { class: 'hrow', style: 'gap:6px' }, ...p.links.slice(0, 4).map(l => h('a', { class: 'pill', href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, l.label + ' ↗'))) : null,
        h('div', {}, h('div', { class: 'hrow between small' }, h('span', { class: 'muted' }, 'Average progress'), h('b', {}, avg + '%')), bar(avg, cy.some(i => i.status === 'off-track'))),
        h('div', { class: 'hrow' }, STATUS_LABELS.filter(l => mix[l]).map(l => chip(statusClassOf(l), `${mix[l]} ${l.toLowerCase()}`))),
        muted('People: ' + top, 'small'),
        miniList(all.filter(i => i.status !== 'complete' && i.tier !== 'done').sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.rank ?? 999) - (b.rank ?? 999)), () => openProject(p.slug)),
        h('div', { class: 'hrow' }, h('button', { class: 'btn', onClick: () => { Object.assign(S.f, { q: '', project: p.slug, status: '', tier: '' }); go('backlog'); } }, 'Open in backlog'), h('button', { class: 'btn', onClick: () => newInitiativePage(p.slug) }, 'New initiative')));
    })),
    d.projects.length ? null : muted('No projects yet. Create one to start adding initiatives.'),
  ];
}
const statusClassOf = l => ({ 'On Track': 's-on', 'At Risk': 's-risk', 'Off Track': 's-off', 'Not Started': 's-ns', Shipped: 's-ship' }[l] || 's-none');

// ---- backlog: filters, grouping (rows, and optionally columns as a matrix), sorting
function select(key, name, options, value, set) {
  return label(name, h('select', { class: 'field', 'data-k': key, onChange: e => { set(e.target.value); render(); } }, opts(options, value)));
}
export function backlog() {
  const f = S.f, q = f.q.trim().toLowerCase(), all = items();
  const sortKey = it => ({ title: it.title.toLowerCase(), status: STATUS_ORDER[it.status] ?? 9, project: it.projectTitle.toLowerCase(), effort: EFFORT_ORDER[it.effort] || 9, date: it.target ? new Date(it.target).getTime() : 9e15, champion: (it.owner || '~').toLowerCase() }[S.sortKey] ?? (TIER_ORDER[it.tier] * 1000 + (it.rank ?? 999)));
  const shown = all.filter(it => (!f.project || it.project === f.project) && (!f.status || it.statusLabel === f.status) && (!f.mission || (it.mission || 'No mission') === f.mission) && (!f.tier || it.tier === f.tier) && (!f.effort || (it.effort || 'Unsized') === f.effort) && (!f.champion || it.owner === f.champion)
    && (!q || [it.title, it.projectTitle, it.owner, it.contributors.join(' '), it.ships, it.risks, it.description].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => { const x = sortKey(a), y = sortKey(b); return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * S.sortDir; });
  const groupMap = dim => { const m = {}, order = []; shown.forEach(it => dimVals(it, dim).forEach(k => { if (!m[k]) { m[k] = []; order.push(k); } m[k].push(it); })); return { m, order }; };
  const sortKeys = (keys, dim) => dim === 'status' ? keys.sort((a, b) => STATUS_LABELS.indexOf(a) - STATUS_LABELS.indexOf(b)) : dim === 'effort' ? keys.sort((a, b) => (EFFORT_ORDER[a] || 9) - (EFFORT_ORDER[b] || 9)) : keys.sort();
  const gy = groupMap(S.gy), yKeys = sortKeys(gy.order.slice(), S.gy);
  // a compact toolbar: a search box and small dropdown pills that show their name until something is chosen
  const pill = (key, name, list, value, set) => {
    const open = !!S.lk && S.lk.key === key, q = open ? S.lk.q.trim().toLowerCase() : '';
    const cur = (list.find(x => x[0] === value) || [])[1];
    const found = open ? list.filter(x => String(x[1]).toLowerCase().includes(q)) : [];
    const rows = open ? [...(q ? [] : [['', `Any ${name.toLowerCase()}`]]), ...found] : [];
    const commit = v => { set(v); S.lk = null; render(); };
    const input = open ? h('input', { class: 'lk-search', type: 'search', 'data-k': 'lk-q', value: S.lk.q, placeholder: `Search ${name.toLowerCase()}…`, 'aria-label': `Search ${name.toLowerCase()}`, autocomplete: 'off',
      onInput: e => { S.lk.q = e.target.value; S.lk.at = 0; render(); },
      onKeyDown: e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); S.lk.at = Math.min(S.lk.at + 1, rows.length - 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); S.lk.at = Math.max(S.lk.at - 1, 0); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (rows[S.lk.at]) commit(rows[S.lk.at][0]); }
        else if (e.key === 'Escape') { S.lk = null; render(); }
      } }) : null;
    if (open && S.lk.fresh) { S.lk.fresh = false; setTimeout(() => input.focus(), 0); }
    return h('div', { class: 'lookup' },
      h('button', { class: 'fsel' + (value ? ' active' : ''), 'aria-haspopup': 'listbox', 'aria-expanded': String(open), title: name, onClick: () => { S.lk = open ? null : { key, q: '', at: 0, fresh: true }; render(); } },
        value ? h('span', {}, h('span', { class: 'fsel-l' }, name + ': '), cur || value) : name, h('span', { class: 'fsel-caret', 'aria-hidden': 'true' }, '⌄')),
      open ? h('div', { class: 'lk-menu', role: 'listbox' }, input,
        h('div', { class: 'lk-list' }, ...rows.map(([v, l], k) => h('div', { class: 'lk-opt' + (k === S.lk.at ? ' on' : ''), role: 'option', 'aria-selected': String(v === value),
          onMouseDown: e => { e.preventDefault(); commit(v); } }, h('span', {}, l), v === value && v ? h('span', { class: 'lk-check' }, '✓') : null)),
          rows.length ? null : h('div', { class: 'lk-empty' }, 'Nothing matches.'))) : null);
  };
  const inline = (key, name, list, value, set) => h('label', { class: 'fsel' }, h('span', { class: 'fsel-l' }, name),
    h('select', { 'data-k': key, 'aria-label': name, onChange: e => { set(e.target.value); render(); } }, opts(list, value)));
  const active = Object.values(f).filter(Boolean).length;
  const filters = h('div', { class: 'filterbar' },
    h('div', { class: 'fb-row' },
      h('input', { class: 'fb-search', type: 'search', 'data-k': 'q', value: f.q, placeholder: 'Search initiatives, people, tasks', 'aria-label': 'Search', onInput: e => { f.q = e.target.value; render(); } }),
      pill('f-project', 'Project', D().projects.map(p => [p.slug, p.title]), f.project, v => { f.project = v; }),
      pill('f-status', 'Status', STATUS_LABELS.map(x => [x, x]), f.status, v => { f.status = v; }),
      pill('f-mission', 'Mission', uniq(all.map(i => i.mission || 'No mission')).map(m => [m, m]), f.mission, v => { f.mission = v; }),
      pill('f-tier', 'Tier', TIERS.slice(1), f.tier, v => { f.tier = v; }),
      pill('f-effort', 'Effort', ['S', 'M', 'L', 'XL', 'Unsized'].map(x => [x, x]), f.effort, v => { f.effort = v; }),
      pill('f-champion', 'Champion', uniq(all.map(i => i.owner).filter(Boolean)).map(n => [n, n]), f.champion, v => { f.champion = v; }),
      active ? h('button', { class: 'fb-clear', onClick: () => { Object.assign(f, { q: '', project: '', status: '', mission: '', tier: '', effort: '', champion: '' }); render(); } }, `Clear filters (${active})`) : null,
      h('span', { class: 'fb-count' }, `${shown.length} of ${all.length} initiatives`)),
    h('div', { class: 'fb-row fb-view' },
      inline('gy', 'Group by', DIMS, S.gy, v => { S.gy = v; }),
      inline('gx', 'Columns', [['none', 'None'], ...DIMS], S.gx, v => { S.gx = v; }),
      inline('sort', 'Sort', [['rank', 'Tier and rank'], ['title', 'Title'], ['status', 'Status'], ['project', 'Project'], ['effort', 'Effort'], ['date', 'Target date'], ['champion', 'Champion']], S.sortKey, v => { S.sortKey = v; }),
      h('button', { class: 'fsel fsel-btn', 'aria-label': 'Reverse the order', onClick: () => { S.sortDir = -S.sortDir; render(); } }, S.sortDir === 1 ? '↑ Ascending' : '↓ Descending')));
  let body;
  if (S.gx !== 'none') {
    const gx = groupMap(S.gx), xKeys = sortKeys(gx.order.slice(), S.gx);
    body = h('div', { class: 'card', style: 'overflow-x:auto;padding:12px' }, h('table', { style: 'border-collapse:separate;border-spacing:6px;min-width:100%' },
      h('thead', {}, h('tr', {}, h('th', { class: 'lbl', style: 'text-align:left;min-width:150px' }, `${dimName(S.gy)} ↓ / ${dimName(S.gx)} →`), xKeys.map(k => h('th', { class: 'lbl', style: 'text-align:left;min-width:190px' }, `${k} (${gx.m[k].length})`)))),
      h('tbody', {}, yKeys.map(k => h('tr', {}, h('td', { style: 'vertical-align:top;font-weight:600;padding-top:6px' }, k, h('div', { class: 'muted', style: 'font-weight:400;font-size:12px' }, `${gy.m[k].length} items`)),
        xKeys.map(xk => h('td', { style: 'vertical-align:top;background:#f8f9fb;border-radius:8px;padding:6px' }, h('div', { class: 'stack', style: 'gap:4px' }, gy.m[k].filter(i => dimVals(i, S.gx).includes(xk)).map(pill)))))))));
  } else {
    body = h('div', { class: 'stack', style: 'gap:14px' }, yKeys.map(k => {
      const its = gy.m[k], c = {}; its.forEach(i => { c[i.statusLabel] = (c[i.statusLabel] || 0) + 1; });
      return h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'hrow', style: 'align-items:baseline;flex-wrap:nowrap' }, h('div', { style: 'font-size:15px;font-weight:700' }, k), h('div', { class: 'muted small' }, `${its.length} items · ${Object.entries(c).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ')}`)), list(its.map(i => itemRow(i, null, i.id === route0()))));
    }));
  }
  return [filters, body, shown.length ? null : muted('Nothing matches.')];
}
const route0 = () => new URLSearchParams((location.hash.split('?')[1] || '')).get('i');

// ---- people
// The directory of people the planner can name as a champion or contributor. They are added by hand for now; each is a
// page in the vault with a `source`, so a sync from the company's people system can fill the same pages later.
const pillSel = (key, name, list, value, set) => h('label', { class: 'fsel' + (value ? ' active' : ''), title: name },
  h('select', { 'data-k': key, 'aria-label': name, onChange: e => { set(e.target.value); render(); } }, opts([['', name], ...list], value)));
export const LOAD_RULE = 'Load: a champion counts 2 and a contributor 1, on unshipped items in the active cycle. 6 is heavy, 10 is overloaded.';
// capacity, not progress: ten segments, filled up to the person's load
export const meter = p => h('span', { class: 'pips' + (p.load.score >= 10 ? ' hot' : p.load.score >= 6 ? ' warm' : ''), title: LOAD_RULE, role: 'img', 'aria-label': `Load ${p.load.score} of 10` }, ...Array.from({ length: 10 }, (_, k) => h('i', { class: k < p.load.score ? 'on' : '' })));

export function people() {
  const d = D(), pq = S.pq.trim().toLowerCase(), byId = Object.fromEntries(items().map(i => [i.id, i])), open = route().person;
  const projectsOf = p => [...new Set(p.ch.concat(p.co).map(id => byId[id] && byId[id].projectTitle).filter(Boolean))].join(', ');
  const teams = uniq(d.people.map(p => p.team).filter(Boolean));
  const rows = d.people.filter(p => {
    if (pq && `${p.n} ${p.role} ${p.team} ${projectsOf(p)}`.toLowerCase().indexOf(pq) < 0) return false;
    if (S.pt && p.team !== S.pt) return false;
    return { over: p.tag === 'Overloaded' || p.tag === 'Heavy', champ: p.ch.length > 0, contrib: !p.ch.length && p.co.length > 0, none: !p.ch.length && !p.co.length }[S.pf] ?? true;
  });
  const over = d.people.filter(p => p.tag === 'Overloaded' || p.tag === 'Heavy').length;
  const filtered = S.pq.trim() || S.pf !== 'all' || S.pt;
  const row = p => h('button', { class: 'mini person' + (p.n === open ? ' sel' : ''), onClick: () => openPerson(p.n) },
    h('span', { class: 'mini-main' }, h('span', { class: 'mini-title' }, p.n), h('span', { class: 'mini-sub' }, [p.role, p.team].filter(Boolean).join(' · ') || (projectsOf(p) || 'Not on any initiative') + (p.inDirectory ? '' : ' · not in the directory'))),
    h('span', { class: 'person-load' }, h('span', { class: 'mini-sub' }, h('b', {}, `Load ${p.load.score} of 10`), ` · ${p.load.c} champion, ${p.load.k} contributor`), meter(p)),
    h('span', { class: 'person-tag' }, chip(p.tagClass, p.tag)));
  return h('div', { class: 'stack', style: 'gap:14px' },
    h('div', { class: 'filterbar', style: 'border-bottom:0;padding-bottom:0' }, h('div', { class: 'fb-row' },
      h('input', { class: 'fb-search', type: 'search', 'data-k': 'pq', value: S.pq, placeholder: 'Search by name, role, team or project', 'aria-label': 'Search people', onInput: e => { S.pq = e.target.value; render(); } }),
      pillSel('pf', 'Show', [['over', 'Heavy or overloaded'], ['champ', 'Champions'], ['contrib', 'Contributors only'], ['none', 'Has room']], S.pf === 'all' ? '' : S.pf, v => { S.pf = v || 'all'; }),
      teams.length ? pillSel('pt', 'Team', teams.map(t => [t, t]), S.pt || '', v => { S.pt = v; }) : null,
      filtered ? h('button', { class: 'fb-clear', onClick: () => { S.pq = ''; S.pf = 'all'; S.pt = ''; render(); } }, 'Clear filters') : null,
      h('span', { class: 'fb-count' }, `${rows.length} of ${d.people.length} people${over ? ` · ${over} heavy` : ''}`),
      h('button', { class: 'btn sm pri', onClick: () => { S.modal = { kind: 'person' }; S.err = ''; render(); } }, '+ New person'))),
    list(rows.map(row)), rows.length ? null : muted(d.people.length ? 'Nobody matches.' : 'No people yet. Add one with + New person.', 'small'));
}

document.addEventListener('mousedown', e => { if (S.lk && !e.target.closest('.lookup')) { S.lk = null; render(); } });

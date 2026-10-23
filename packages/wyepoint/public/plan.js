// Plan (the next cycle: pool, ranking, checks, release, start), History (every cycle, snapshots once closed) and Settings.
import { S, TOKEN_KEY, h, chip, bar, muted, label, api, act, render, openIt, items, cyc, D, range, cycleChip, stClass, cap } from './core.js';
import { pill, list } from './views.js';
import { openSimulation } from './simulate.js';

const POOL_RANK = { carry: 0, proposed: 1, next: 2, later: 3, icebox: 4 };

export function plan() {
  const d = D(), A = cyc(d.active), nx = cyc(d.nx), locked = nx.status !== 'planned', all = items();
  const planned = all.filter(i => i.cycle === nx.n).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.title.localeCompare(b.title));
  const q = S.planQ.trim().toLowerCase();
  const pool = all.filter(i => i.tier in POOL_RANK && (!q || `${i.title} ${i.projectTitle} ${i.owner}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0) || POOL_RANK[a.tier] - POOL_RANK[b.tier] || a.title.localeCompare(b.title));
  const ranks = list => Promise.all(list.map((i, k) => i.rank === k + 1 ? null : api('PATCH', `/initiatives/${i.id}`, { rank: k + 1 })));
  const move = (i, dir) => act(async () => { const l = planned.slice(), a = l.indexOf(i), b = a + dir; if (b < 0 || b >= l.length) return; [l[a], l[b]] = [l[b], l[a]]; await ranks(l); });
  const pe = { theme: nx.theme, start: nx.start, end: nx.end };
  const pickBtn = (text, onClick, extra = '') => h('button', { class: 'btn sm ' + extra, onClick }, text);
  const hint = nx.status === 'planned' ? 'Release when every planned item is approved and the checks are clear.' : nx.status === 'released' ? 'Plan released and locked. Start it when the active cycle closes.' : 'This cycle is active.';
  const unapproved = planned.some(i => !i.approved);
  return [
    h('div', { class: 'card' }, h('div', { class: 'hrow between', style: 'align-items:baseline' }, h('h3', {}, `Plan ${nx.name}`), cycleChip(nx)),
      muted('Anything can be added to the backlog at any time. Only approved projects can be added to a cycle, and releasing locks the plan.', 'small'),
      h('div', { class: 'hrow', style: 'align-items:flex-end' },
        label('Theme', h('input', { class: 'field', value: pe.theme, placeholder: 'Theme or goal for the cycle', onInput: e => { pe.theme = e.target.value; } }), 'flex:1 1 220px'),
        label('Start (YYYY-MM-DD)', h('input', { class: 'field', style: 'width:150px', value: pe.start, onInput: e => { pe.start = e.target.value; } })),
        label('End (YYYY-MM-DD)', h('input', { class: 'field', style: 'width:150px', value: pe.end, onInput: e => { pe.end = e.target.value; } })),
        h('button', { class: 'btn', onClick: () => act(() => api('PATCH', `/cycles/${nx.n}`, pe)) }, 'Save details'))),
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'cols' },
      h('div', { class: 'card grow', style: 'flex-basis:640px' },
        h('div', { class: 'hrow between', style: 'align-items:flex-end' }, h('div', {}, h('div', { class: 'lbl' }, 'Backlog pool'), muted(`${pool.length} candidates · carry-overs first, no free pass`, 'small')),
          h('input', { class: 'field', type: 'search', 'data-k': 'planQ', 'aria-label': 'Search the pool', style: 'flex:1 1 180px;max-width:260px', value: S.planQ, placeholder: 'Search the pool', onInput: e => { S.planQ = e.target.value; render(); } })),
        list(pool.slice(0, 60).map(i => h('div', { class: 'row', style: 'flex-wrap:wrap;cursor:default' },
          h('div', { style: 'flex:1 1 220px;min-width:0' }, h('button', { class: 'pill', style: 'border:0;padding:0;background:transparent;font-weight:600', onClick: () => openIt(i.id) }, i.title), h('div', { class: 'muted small' }, `${i.projectTitle} · ${i.owner || 'No champion'}`)),
          chip('s-none', i.tierLabel), chip('s-none', i.effort || 'Unsized'),
          pickBtn('Simulate', () => openSimulation(i)),
          pickBtn(i.approved ? 'Approved' : 'Approve', () => act(() => api('PATCH', `/initiatives/${i.id}`, { approved: !i.approved })), i.approved ? 'on' : ''),
          h('button', { class: 'btn sm pri', disabled: !(i.approved && !locked), onClick: () => act(() => api('PATCH', `/initiatives/${i.id}`, { cycle: nx.n, rank: planned.length + 1, approved: true })) }, i.approved ? `Add to ${nx.name}` : 'Approve first')))),
        pool.length ? null : muted('Nothing to pick from.')),
      h('div', { class: 'grow stack', style: 'gap:12px;flex-basis:420px' },
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, `${nx.name} ranked plan (${planned.length})`),
          list(planned.map((i, k) => h('div', { class: 'row', style: 'cursor:default' }, h('div', { style: 'width:28px;font-weight:700;flex:none' }, k + 1),
            h('div', { style: 'flex:1 1 auto;min-width:0' }, h('button', { class: 'pill', style: 'border:0;padding:0;background:transparent;font-weight:600', onClick: () => openIt(i.id) }, i.title), h('div', { class: 'muted small' }, `${i.projectTitle} · ${i.owner || 'No champion'} · ${i.effort || 'Unsized'}`)),
            h('button', { class: 'btn sm', onClick: () => openSimulation(i) }, 'Simulate'),
            locked ? null : [h('button', { class: 'btn sm', 'aria-label': 'Move up', onClick: () => move(i, -1) }, 'Up'), h('button', { class: 'btn sm', 'aria-label': 'Move down', onClick: () => move(i, 1) }, 'Down'),
              h('button', { class: 'btn sm', 'aria-label': 'Remove from plan', onClick: () => act(() => api('PATCH', `/initiatives/${i.id}`, { cycle: null, rank: null })) }, 'Remove')]))),
          planned.length ? null : muted('Nothing planned yet. Approve projects in the pool, then add them.')),
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, 'Plan checks'), ...d.checks.map(c => h('div', { style: 'color:#8a1c12' }, '• ' + c)), d.checks.length ? null : muted('No issues found.')),
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, 'Release'),
          h('div', { class: 'hrow' },
            nx.status === 'planned' ? h('button', { class: 'btn pri', disabled: !d.canRelease, onClick: () => act(() => api('POST', '/cycles/release')) }, `Release ${nx.name} plan`) : null,
            nx.status === 'released' ? h('button', { class: 'btn', onClick: () => act(() => api('POST', '/cycles/reopen')) }, 'Reopen planning') : null,
            nx.status === 'released' ? h('button', { class: 'btn pri', onClick: () => { S.confirmStart = true; render(); } }, `Close ${A.name} and start ${nx.name}`) : null),
          S.confirmStart && nx.status === 'released' ? h('div', { class: 'stack' },
            h('div', { class: 'agent' }, `Closing ${A.name} saves a snapshot to History. Items not shipped become carry-overs and are not ranked automatically in ${nx.name}.`),
            h('div', { class: 'hrow' }, h('button', { class: 'btn pri', onClick: () => act(() => api('POST', '/cycles/start-next'), () => { S.confirmStart = false; S.histSel = null; location.hash = '#/overview'; }) }, 'Confirm'), h('button', { class: 'btn', onClick: () => { S.confirmStart = false; render(); } }, 'Cancel'))) : null,
          muted(hint + (nx.status === 'planned' && unapproved ? ' Some planned items are not approved.' : ''), 'small')))),
  ];
}

export function history() {
  const d = D(), sel = S.histSel ?? d.active, c = cyc(sel);
  const rows = c.rows.slice().sort((a, b) => (parseInt(a.rank, 10) || 999) - (parseInt(b.rank, 10) || 999));
  const note = c.status === 'closed' && c.snapshot ? `Snapshot saved when the cycle closed on ${c.closedAt}. ${c.rows.length - c.shipped} item(s) were not shipped and became carry-overs.`
    : c.status === 'closed' ? 'Closed without a snapshot, so this shows the projects now recorded against the cycle.' : c.status === 'active' ? 'Live view of the active cycle.' : 'Planned items, ranked.';
  return h('div', { class: 'cols' },
    h('div', { class: 'stack', style: 'flex:1 1 300px;max-width:420px' }, list(d.cycles.map(x => h('button', { class: 'row' + (x.n === sel ? ' sel' : ''), style: 'flex-direction:column;align-items:stretch;gap:6px', onClick: () => { S.histSel = x.n; render(); } },
      h('div', { class: 'hrow between', style: 'flex-wrap:nowrap' }, h('b', {}, x.name), cycleChip(x)), h('div', { class: 'muted small' }, range(x) + (x.theme ? ' · ' + x.theme : '')),
      h('div', { class: 'hrow between small', style: 'flex-wrap:nowrap' }, h('span', {}, `${x.rows.length} items · ${x.shipped} shipped`), h('span', {}, `${x.avg}% avg progress`)))))),
    h('div', { class: 'card', style: 'flex:2 1 520px;min-width:0' }, h('h3', {}, c.name + (c.theme ? ' · ' + c.theme : '')), muted(note, 'small'),
      list(rows.map(r => h('button', { class: 'row', onClick: () => openIt(r.id) }, h('div', { style: 'width:30px;font-weight:700;color:var(--muted);flex:none' }, r.rank || ''),
        h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', { style: 'font-weight:600' }, r.title), h('div', { class: 'muted small' }, `${r.project} · ${r.champion || 'No champion'}`)),
        h('div', { style: 'width:44px;text-align:right;font-size:12px;font-weight:600' }, (r.pct || 0) + '%'),
        chip(stClass(statusLabel(r.status)), r.status ? statusLabel(r.status) : (c.status === 'planned' || c.status === 'released' ? 'Planned' : 'No status'))))),
      rows.length ? null : muted('No projects recorded for this cycle.')));
}
const statusLabel = s => (D().enums.labels[s]) || '';

export function settings() {
  const c = D().config, v = { title: c.title, weeks: c.weeks, cooldown: c.cooldown, start: c.start }, origin = location.origin;
  let hasToken = false; try { hasToken = !!localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  return [
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Workspace and planning cycle'), muted('The length and the start date give every cycle its dates; a cycle can still be given its own dates on the Plan page. Changing the length re-dates cycles that have no dates of their own.', 'small'),
      h('div', { class: 'hrow', style: 'align-items:flex-end' },
        label('Name', h('input', { class: 'field', style: 'width:200px', value: v.title, onInput: e => { v.title = e.target.value; } })),
        label('Cycle length (weeks)', h('input', { class: 'field', type: 'number', min: 1, max: 26, style: 'width:140px', value: v.weeks, onInput: e => { v.weeks = e.target.value; } })),
        label('Cooldown (days)', h('input', { class: 'field', type: 'number', min: 0, max: 60, style: 'width:140px', value: v.cooldown, onInput: e => { v.cooldown = e.target.value; } })),
        label('Cycle 0 starts (YYYY-MM-DD)', h('input', { class: 'field', style: 'width:170px', value: v.start, onInput: e => { v.start = e.target.value; } })),
        h('button', { class: 'btn pri', onClick: () => act(() => api('PATCH', '/config', v)) }, 'Save'))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Types'), h('div', { class: 'card-sub' }, 'WyePoint is built on Wye\'s type system. Define your own — a risk, a decision, a customer ask — and insert it anywhere in a page with /.')),
        h('button', { class: 'btn sm pri', onClick: () => { S.modal = { kind: 'type' }; S.err = ''; render(); } }, '+ New type')),
      h('div', { class: 'type-core' }, h('span', { class: 'lbl' }, 'Built in'), ...['Person', 'Cycle', 'Goal · GOAL', 'Project · PROJ', 'Milestone · TASK'].map(n => chip('s-none', n)), h('span', { class: 'muted small' }, 'declared in types/ontology.md')),
      list(D().types.map(t => h('div', { class: 'row type-row', style: 'cursor:default' },
        h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', { style: 'font-weight:600' }, t.name, h('span', { class: 'key-chip' }, t.key), h('span', { class: 'muted small' }, `  ${t.slug}:`)), h('div', { class: 'muted small' }, t.purpose),
          h('div', { class: 'hrow', style: 'gap:6px;margin-top:4px' }, ...t.statuses.map(s => chip('s-ns', s)), ...t.fields.map(f => chip('s-none', `${f.name} · ${(D().fieldKinds.find(k => k[0] === f.kind) || [0, f.kind])[1].toLowerCase()}`)))),
        h('span', { class: 'muted small' }, `${t.used} in use`),
        t.builtin ? chip('s-none', 'Built in') : h('button', { class: 'btn sm', onClick: () => { S.modal = { kind: 'type', slug: t.slug, v: { key: t.key, name: t.name, plural: t.plural, purpose: t.purpose, statuses: t.statuses.join(', '), fields: t.fields.map(f => ({ name: f.name, kind: f.kind, options: (f.options || []).join(', ') })) } }; S.err = ''; render(); } }, 'Edit'),
        t.builtin ? null : h('button', { class: 'btn sm', onClick: () => act(() => api('DELETE', `/types/${t.slug}`)) }, 'Delete')))),
      D().types.some(t => !t.builtin) ? null : muted('No types of your own yet.', 'small')),
    h('div', { class: 'card' }, h('h3', {}, 'Push data in'), muted('Anything that can POST JSON can add a log line, a link, a pull request, a milestone or a status to a project. Needs the write token.', 'small'),
      h('div', { class: 'code' }, `curl -X POST ${origin}/api/ingest \\\n  -H "authorization: Bearer $WYEPOINT_TOKEN" -H "content-type: application/json" \\\n  -d '{"source":"jira","project":"area/slug","kind":"link","label":"PROJ-123","url":"https://…","text":"PROJ-123 moved to Done"}'`),
      muted('kind is log (text), link (label, url), pr (title, url), status (status) or task (title, owner, due, status; the same title again updates it). GitHub: point a webhook for pull requests and issues at /api/ingest/github with WYEPOINT_GITHUB_SECRET set, and put wyepoint:<area>/<slug> in the PR title, branch or description.', 'small')),
    h('div', { class: 'card' }, h('h3', {}, 'Write token'), muted(hasToken ? 'A token is saved in this browser.' : 'No token saved in this browser. You are asked for it when you first save something on a server that needs one.', 'small'),
      h('div', {}, h('button', { class: 'btn', onClick: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } render(); } }, 'Forget token'))),
  ];
}

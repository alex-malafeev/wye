// Tempo's page. State comes from GET /api/state; every change is an API call followed by a reload of that state, so
// what is on screen is what is in the vault. The DOM is built with textContent only — nothing from the vault is HTML.
const TABS = [['overview', 'Overview'], ['projects', 'Projects'], ['backlog', 'Backlog'], ['plan', 'Plan'], ['history', 'History'], ['settings', 'Settings']];
const ST = { 'on-track': ['s-on', 'On track'], 'at-risk': ['s-risk', 'At risk'], 'off-track': ['s-off', 'Off track'], proposed: ['s-ns', 'Proposed'], complete: ['s-ship', 'Complete'], paused: ['s-none', 'Paused'] };
const TST = { todo: 'To do', 'in-progress': 'In progress', blocked: 'Blocked', review: 'Review', done: 'Done' };
const TOKEN_KEY = 'tempo_token';

const S = { data: null, err: '', toast: '', filters: { q: '', project: '', status: '', owner: '', cycle: '' }, modal: null, confirmStart: false };
const app = document.getElementById('app');

// ---- tiny DOM helper
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const chip = (cls, text) => h('span', { class: 'chip ' + cls }, text);
const stChip = s => chip(...ST[s] || ['s-none', s]);
const bar = (pct, hot) => h('div', { class: 'bar' + (hot ? ' hot' : '') }, h('i', { style: `width:${pct || 0}%` }));
const safeUrl = u => /^https?:\/\//i.test(u) ? u : '#';

// ---- api
async function api(method, path, body, retry = true) {
  const token = localStorage.getItem(TOKEN_KEY);
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && retry && method !== 'GET') {
    const t = window.prompt('This server needs its write token to save changes:');
    if (t) { localStorage.setItem(TOKEN_KEY, t.trim()); return api(method, path, body, false); }
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}
async function act(fn, done) {
  try { await fn(); S.err = ''; await load(); if (done) done(); } catch (e) { S.err = e.message; render(); }
}
async function load() { S.data = await api('GET', '/state'); render(); }

// ---- routing: #/<view>?i=<project>/<slug>
function route() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  const view = TABS.some(t => t[0] === p) ? p : 'overview';
  return { view, open: new URLSearchParams(q || '').get('i') };
}
function go(view, open) { location.hash = `#/${view}` + (open ? `?i=${encodeURIComponent(open).replace(/%2F/g, '/')}` : ''); }
const openIt = id => go(route().view, id);
window.addEventListener('hashchange', render);

// ---- derived
const cyc = n => S.data.cycles.find(c => c.n === n) || { n, name: `Cycle ${n}`, start: '', end: '' };
const proj = slug => S.data.projects.find(p => p.slug === slug) || { title: slug };
const cur = () => Math.max(0, S.data.current);
const items = () => S.data.initiatives;
const byRank = (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.title.localeCompare(b.title);
const inCycle = n => items().filter(i => i.cycle === n).sort(byRank);
const pctOf = i => i.progress == null ? (i.status === 'complete' ? 100 : 0) : i.progress;
const needsAttention = i => ['at-risk', 'off-track', 'paused'].includes(i.status) || (i.cycle === cur() && !i.owner) || i.tasks.some(t => t.status === 'blocked');
const why = i => [['at-risk', 'At risk'], ['off-track', 'Off track'], ['paused', 'Paused']].filter(([s]) => i.status === s).map(x => x[1]).concat(i.tasks.some(t => t.status === 'blocked') ? [`${i.tasks.filter(t => t.status === 'blocked').length} blocked task(s)`] : [], i.cycle === cur() && !i.owner ? ['No owner'] : []).join(' · ');
const sub = i => [proj(i.project).title, i.owner || 'No owner', i.cycle == null ? 'Backlog' : cyc(i.cycle).name].join(' · ');

// ---- rows used in several views
function itemRow(i, extra) {
  return h('button', { class: 'row', onClick: () => openIt(i.id) },
    h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', { style: 'font-weight:600' }, i.title), h('div', { class: 'muted small' }, extra || sub(i))),
    i.effort ? chip('s-none', i.effort) : null, stChip(i.status),
    h('div', { style: 'width:120px;flex:none' }, h('div', { class: 'muted', style: 'font-size:12px;text-align:right' }, i.progress == null ? '–' : i.progress + '%'), bar(pctOf(i), i.status === 'off-track')));
}
const empty = text => h('div', { class: 'muted' }, text);

// ---- views
function overview() {
  const c = cyc(cur()), list = inCycle(cur()), all = items();
  const n = s => list.filter(i => i.status === s).length;
  const tasks = list.flatMap(i => i.tasks), done = tasks.filter(t => t.status === 'done').length;
  const tiles = [['In ' + c.name, list.length, `${all.length} initiatives in total`], ['On track', n('on-track'), ''], ['At risk', n('at-risk'), ''], ['Off track', n('off-track'), ''], ['Complete', n('complete'), ''], ['Tasks done', `${done}/${tasks.length}`, 'in this cycle']];
  const total = (new Date(c.end) - new Date(c.start)) / 864e5 + 1, el = Math.max(0, Math.min(total, (new Date(S.data.today) - new Date(c.start)) / 864e5 + 1));
  const recent = all.flatMap(i => i.log.slice(0, 3).map(l => ({ ...l, it: i }))).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  return [
    h('div', { class: 'tiles' }, tiles.map(([l, v, s]) => h('div', { class: 'card' }, h('div', { class: 'lbl' }, l), h('div', { class: 'v' }, v), h('div', { class: 'muted', style: 'font-size:12px' }, s)))),
    h('div', { class: 'card' },
      h('div', { class: 'hrow between' }, h('div', { class: 'lbl' }, c.name + ' timeline'), h('div', { class: 'muted' }, S.data.current < 0 ? `Starts ${c.start}` : `Week ${Math.min(S.data.config.weeks, Math.ceil(el / 7))} of ${S.data.config.weeks} · ${c.start} → ${c.end}`)),
      h('div', { class: 'bar big' }, h('i', { style: `width:${total ? el / total * 100 : 0}%` }))),
    h('div', { class: 'cols' },
      h('div', { class: 'card', style: 'flex:2 1 520px;min-width:0' }, h('div', { class: 'lbl' }, 'Needs attention'),
        ...(all.filter(needsAttention).map(i => itemRow(i, `${sub(i)} · ${why(i)}`))), all.some(needsAttention) ? null : empty('Nothing flagged.')),
      h('div', { class: 'card', style: 'flex:1 1 300px;min-width:0' }, h('div', { class: 'lbl' }, 'Recent activity'),
        ...recent.map(l => h('button', { class: 'row', onClick: () => openIt(l.it.id) }, h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', {}, l.text), h('div', { class: 'muted small' }, `${l.it.title} · ${l.ts.slice(0, 10)}`)), h('span', { class: 'source' }, l.source))),
        recent.length ? null : empty('No activity yet.'))),
  ];
}

function projects() {
  return [
    h('div', { class: 'hrow' }, h('button', { class: 'btn', onClick: () => { S.modal = { kind: 'project' }; render(); } }, 'New project')),
    h('div', { class: 'grid' }, S.data.projects.map(p => {
      const mine = items().filter(i => i.project === p.slug).sort((a, b) => (a.cycle ?? 1e9) - (b.cycle ?? 1e9) || byRank(a, b));
      const avg = mine.length ? Math.round(mine.reduce((s, i) => s + pctOf(i), 0) / mine.length) : 0;
      const mix = ['on-track', 'at-risk', 'off-track', 'proposed', 'complete', 'paused'].map(s => [s, mine.filter(i => i.status === s).length]).filter(x => x[1]);
      return h('div', { class: 'card' },
        h('div', { class: 'hrow between' }, h('h3', {}, p.title), h('span', { class: 'muted small' }, `${mine.length} initiatives`)),
        p.description ? h('div', { class: 'muted small' }, p.description) : null,
        h('div', {}, h('div', { class: 'hrow between small' }, h('span', { class: 'muted' }, 'Average progress'), h('b', {}, avg + '%')), bar(avg)),
        h('div', { class: 'hrow' }, mix.map(([s, k]) => chip(ST[s][0], `${k} ${ST[s][1].toLowerCase()}`))),
        h('div', { class: 'stack', style: 'gap:4px' }, mine.map(i => h('button', { class: 'pill', onClick: () => openIt(i.id) }, stChip(i.status), ' ', i.title, h('span', { class: 'muted' }, i.cycle == null ? '' : ` · ${cyc(i.cycle).name}`)))),
        h('button', { class: 'btn', onClick: () => { S.modal = { kind: 'initiative', project: p.slug }; render(); } }, 'New initiative'));
    })),
    S.data.projects.length ? null : empty('No projects yet. Create one to start adding initiatives.'),
  ];
}

function sel(key, label, options) {
  return h('label', { class: 'f' }, h('span', { class: 'lbl' }, label),
    h('select', { class: 'field', 'data-k': key, onChange: e => { S.filters[key] = e.target.value; render(); } }, options.map(([v, l]) => h('option', { value: v, selected: S.filters[key] === v }, l))));
}
function backlog() {
  const f = S.filters, q = f.q.toLowerCase();
  const owners = [...new Set(items().map(i => i.owner).filter(Boolean))].sort();
  const shown = items().filter(i => (!q || [i.title, i.description, i.owner, ...i.tasks.map(t => t.title)].join(' ').toLowerCase().includes(q)) && (!f.project || i.project === f.project) && (!f.status || i.status === f.status) && (!f.owner || i.owner === f.owner) && (f.cycle === '' || (f.cycle === 'none' ? i.cycle == null : i.cycle === +f.cycle)));
  const cycOpts = [['', 'Any'], ['none', 'Backlog (no cycle)'], ...S.data.cycles.map(c => [String(c.n), c.name])];
  return [
    h('div', { class: 'card' }, h('div', { class: 'hrow', style: 'align-items:flex-end' },
      h('label', { class: 'f', style: 'flex:1 1 220px' }, h('span', { class: 'lbl' }, 'Search'), h('input', { class: 'field', type: 'search', 'data-k': 'q', value: f.q, placeholder: 'Initiative, owner, task', onInput: e => { S.filters.q = e.target.value; render(); } })),
      sel('project', 'Project', [['', 'All'], ...S.data.projects.map(p => [p.slug, p.title])]),
      sel('status', 'Status', [['', 'Any'], ...S.data.enums.statuses.map(s => [s, ST[s][1]])]),
      sel('owner', 'Owner', [['', 'Anyone'], ...owners.map(o => [o, o])]),
      sel('cycle', 'Cycle', cycOpts),
      h('button', { class: 'btn', onClick: () => { S.filters = { q: '', project: '', status: '', owner: '', cycle: '' }; render(); } }, 'Clear'),
      h('div', { class: 'muted', style: 'align-self:center' }, `${shown.length} of ${items().length}`))),
    h('div', { class: 'stack' }, shown.sort((a, b) => (a.cycle ?? 1e9) - (b.cycle ?? 1e9) || byRank(a, b)).map(i => itemRow(i))),
    shown.length ? null : empty('Nothing matches.'),
  ];
}

function plan() {
  const n = cur() + 1, c = cyc(n), planned = inCycle(n), pool = items().filter(i => (i.cycle == null || i.cycle < cur()) && i.status !== 'complete');
  const setRanks = list => Promise.all(list.map((i, k) => i.rank === k + 1 ? null : api('PATCH', `/initiatives/${i.id}`, { rank: k + 1 })));
  const move = (i, d) => act(async () => { const l = planned.slice(), a = l.indexOf(i), b = a + d; if (b < 0 || b >= l.length) return; [l[a], l[b]] = [l[b], l[a]]; await setRanks(l); });
  const checks = [];
  planned.forEach(i => { if (!i.owner) checks.push(`${i.title} has no owner`); if (!i.effort) checks.push(`${i.title} has no effort estimate`); });
  const load = {}; planned.forEach(i => { if (i.owner) load[i.owner] = (load[i.owner] || 0) + 1; });
  Object.entries(load).filter(([, k]) => k > 3).forEach(([o, k]) => checks.push(`${o} owns ${k} initiatives in ${c.name}`));
  const carry = items().filter(i => i.cycle === cur() && i.status !== 'complete');
  return [
    h('div', { class: 'card' }, h('div', { class: 'hrow between' }, h('h3', {}, `Plan ${c.name}`), h('span', { class: 'muted' }, `${c.start} → ${c.end} · ${S.data.config.weeks} weeks + ${S.data.config.cooldown} days cooldown`)),
      h('div', { class: 'muted small' }, 'Anything can sit in the backlog. Adding an initiative to a cycle approves it. Items in the current cycle that are not complete become carry-overs when the next cycle starts.')),
    h('div', { class: 'cols' },
      h('div', { class: 'card grow' }, h('div', { class: 'lbl' }, 'Backlog pool'), h('div', { class: 'muted small' }, `${pool.length} candidates`),
        ...pool.sort(byRank).map(i => h('div', { class: 'row link', style: 'flex-wrap:wrap' },
          h('div', { style: 'flex:1 1 200px;min-width:0' }, h('button', { class: 'pill', style: 'border:0;padding:0;font-weight:600;background:transparent', onClick: () => openIt(i.id) }, i.title), h('div', { class: 'muted small' }, sub(i))),
          i.effort ? chip('s-none', i.effort) : null,
          h('button', { class: 'btn sm pri', onClick: () => act(() => api('PATCH', `/initiatives/${i.id}`, { cycle: n, approved: true, rank: planned.length + 1 })) }, 'Add to ' + c.name))),
        pool.length ? null : empty('Everything is planned.')),
      h('div', { class: 'grow stack', style: 'gap:12px' },
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, `${c.name} ranked plan (${planned.length})`),
          ...planned.map((i, k) => h('div', { class: 'row' }, h('div', { style: 'width:28px;font-weight:700;flex:none' }, k + 1),
            h('div', { style: 'flex:1 1 auto;min-width:0' }, h('button', { class: 'pill', style: 'border:0;padding:0;font-weight:600;background:transparent', onClick: () => openIt(i.id) }, i.title), h('div', { class: 'muted small' }, sub(i))),
            h('button', { class: 'btn sm', 'aria-label': 'Move up', onClick: () => move(i, -1) }, 'Up'), h('button', { class: 'btn sm', 'aria-label': 'Move down', onClick: () => move(i, 1) }, 'Down'),
            h('button', { class: 'btn sm', 'aria-label': 'Remove from plan', onClick: () => act(() => api('PATCH', `/initiatives/${i.id}`, { cycle: null, rank: null })) }, 'Remove'))),
          planned.length ? null : empty('Nothing planned yet. Add initiatives from the pool.')),
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, 'Plan checks'), ...checks.map(x => h('div', { style: 'color:#8a1c12' }, '• ' + x)), checks.length ? null : empty('No issues found.')),
        h('div', { class: 'card' }, h('div', { class: 'lbl' }, 'Start the next cycle'),
          h('div', { class: 'muted small' }, `${carry.length} initiative(s) in ${cyc(cur()).name} are not complete and would carry over.`),
          h('button', { class: 'btn pri', style: 'align-self:flex-start', onClick: () => { S.confirmStart = true; render(); } }, `Close ${cyc(cur()).name} and start ${c.name}`),
          S.confirmStart ? h('div', { class: 'stack' }, h('div', { class: 'code' }, `Closing ${cyc(cur()).name} moves its ${carry.length} unfinished initiative(s) into the backlog as carry-overs, with a log line on each. They are not ranked in ${c.name} automatically. The cycle start date moves so ${c.name} starts today.`),
            h('div', { class: 'hrow' }, h('button', { class: 'btn pri', onClick: () => act(async () => { await startNext(carry, n); S.confirmStart = false; }) }, 'Confirm'), h('button', { class: 'btn', onClick: () => { S.confirmStart = false; render(); } }, 'Cancel'))) : null))),
  ];
}
// Cycles are derived from the start date, so starting the next cycle early means moving that date: cycle n begins today.
async function startNext(carry, n) {
  const cfg = S.data.config, span = cfg.weeks * 7 + cfg.cooldown, d = new Date(S.data.today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n * span);
  if (n * span > 0 && d < new Date('2000-01-01')) throw new Error('cannot move the cycle start that far back');
  await Promise.all(carry.map(i => api('PATCH', `/initiatives/${i.id}`, { cycle: null, rank: null }).then(() => api('POST', `/initiatives/${i.id}/log`, { text: `Carried over from ${cyc(cur()).name}`, source: 'tempo' }))));
  await api('PATCH', '/config', { start: d.toISOString().slice(0, 10) });
}

function history() {
  const past = S.data.cycles.filter(c => c.n < cur() || (c.n === cur())).sort((a, b) => b.n - a.n);
  const sel = S.histSel ?? (past[0] && past[0].n), list = sel == null ? [] : inCycle(sel);
  return h('div', { class: 'cols' },
    h('div', { class: 'stack', style: 'flex:1 1 300px;max-width:420px' }, past.map(c => {
      const l = inCycle(c.n), done = l.filter(i => i.status === 'complete').length;
      return h('button', { class: 'row' + (c.n === sel ? ' sel' : ''), style: 'flex-direction:column;align-items:stretch;gap:6px', onClick: () => { S.histSel = c.n; render(); } },
        h('div', { class: 'hrow between' }, h('b', {}, c.name), c.n === cur() ? chip('s-on', 'Current') : chip('s-ns', 'Past')), h('div', { class: 'muted small' }, `${c.start} → ${c.end}`), h('div', { class: 'small' }, `${l.length} items · ${done} complete`));
    })),
    h('div', { class: 'card', style: 'flex:2 1 520px;min-width:0' }, h('h3', {}, sel == null ? 'No cycles yet' : cyc(sel).name), ...list.map(i => itemRow(i)), list.length ? null : empty('No initiatives recorded for this cycle.')));
}

function settings() {
  const c = S.data.config, v = { weeks: c.weeks, cooldown: c.cooldown, start: c.start };
  const origin = location.origin;
  return [
    h('div', { class: 'card' }, h('h3', {}, 'Planning cycle'), h('div', { class: 'muted small' }, 'Cycles are derived from the start date and length. Changing the length re-numbers the future, not the history you have already logged against a cycle number.'),
      h('div', { class: 'hrow', style: 'align-items:flex-end' },
        h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Cycle length (weeks)'), h('input', { class: 'field', type: 'number', min: 1, max: 26, style: 'width:140px', value: v.weeks, onInput: e => v.weeks = e.target.value })),
        h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Cooldown (days)'), h('input', { class: 'field', type: 'number', min: 0, max: 60, style: 'width:140px', value: v.cooldown, onInput: e => v.cooldown = e.target.value })),
        h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Cycle 0 starts (YYYY-MM-DD)'), h('input', { class: 'field', style: 'width:170px', value: v.start, onInput: e => v.start = e.target.value })),
        h('button', { class: 'btn pri', onClick: () => act(() => api('PATCH', '/config', v)) }, 'Save'))),
    h('div', { class: 'card' }, h('h3', {}, 'Push data in'), h('div', { class: 'muted small' }, 'Anything that can POST JSON can add a log line, a link, a task or a status to an initiative. Needs the write token.'),
      h('div', { class: 'code' }, `curl -X POST ${origin}/api/ingest \\\n  -H "authorization: Bearer $TEMPO_TOKEN" -H "content-type: application/json" \\\n  -d '{"source":"jira","initiative":"project/slug","kind":"link","label":"PROJ-123","url":"https://…","text":"PROJ-123 moved to Done"}'`),
      h('div', { class: 'muted small' }, 'kind is log (text), link (label, url), status (status) or task (title, owner, due, status). GitHub: point a webhook for pull requests and issues at /api/ingest/github with TEMPO_GITHUB_SECRET set, and put tempo:<project>/<slug> in the PR title, branch or description.')),
    h('div', { class: 'card' }, h('h3', {}, 'Write token'), h('div', { class: 'muted small' }, localStorage.getItem(TOKEN_KEY) ? 'A token is saved in this browser.' : 'No token saved in this browser. You are asked for it when you first save something on a server that needs one.'),
      h('div', {}, h('button', { class: 'btn', onClick: () => { localStorage.removeItem(TOKEN_KEY); render(); } }, 'Forget token'))),
  ];
}

// ---- detail drawer
function drawer(id) {
  const i = items().find(x => x.id === id);
  if (!i) return h('div');
  const field = (label, el) => h('label', { class: 'f' }, h('span', { class: 'lbl' }, label), el);
  const upd = patch => act(() => api('PATCH', `/initiatives/${id}`, patch));
  let desc = i.description, tTitle = '', tOwner = '', lLabel = '', lUrl = '', logText = '';
  const cycleOpts = [['', 'Backlog (no cycle)'], ...S.data.cycles.concat(S.data.cycles.some(c => c.n === cur() + 1) ? [] : [cyc(cur() + 1)]).map(c => [String(c.n), c.name])];
  return h('div', { class: 'scrim' }, h('button', { class: 'back', 'aria-label': 'Close detail', onClick: () => openIt(null) }),
    h('aside', { class: 'drawer' },
      h('div', { class: 'hrow between', style: 'align-items:flex-start' }, h('h2', { style: 'font-size:18px' }, i.title), h('button', { class: 'btn sm', onClick: () => openIt(null) }, 'Close')),
      S.err ? h('div', { class: 'err' }, S.err) : null,
      h('div', { class: 'hrow' }, stChip(i.status), i.effort ? chip('s-none', 'Effort ' + i.effort) : null, chip('s-none', proj(i.project).title), chip('s-none', i.cycle == null ? 'Backlog' : cyc(i.cycle).name)),
      h('div', { class: 'hrow' },
        field('Status', h('select', { class: 'field', onChange: e => upd({ status: e.target.value }) }, S.data.enums.statuses.map(s => h('option', { value: s, selected: s === i.status }, ST[s][1])))),
        field('Cycle', h('select', { class: 'field', onChange: e => upd({ cycle: e.target.value === '' ? null : +e.target.value, ...(e.target.value === '' ? { rank: null } : {}) }) }, cycleOpts.map(([v, l]) => h('option', { value: v, selected: v === String(i.cycle ?? '') }, l)))),
        field('Effort', h('select', { class: 'field', onChange: e => upd({ effort: e.target.value }) }, ['', ...S.data.enums.efforts].map(v => h('option', { value: v, selected: v === i.effort }, v || '–')))),
        field('Owner', h('input', { class: 'field', style: 'width:150px', value: i.owner, onChange: e => upd({ owner: e.target.value }) })),
        field('Target date', h('input', { class: 'field', style: 'width:150px', value: i.due, placeholder: 'YYYY-MM-DD', onChange: e => upd({ due: e.target.value }) }))),
      h('div', {}, h('div', { class: 'hrow between' }, h('div', { class: 'lbl' }, 'Progress'), h('b', {}, i.progress == null ? '–' : i.progress + '%')), bar(pctOf(i), i.status === 'off-track'), h('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, i.progressBasis)),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Description'),
        h('textarea', { class: 'field', style: 'min-height:110px', onInput: e => desc = e.target.value }, i.description),
        h('div', {}, h('button', { class: 'btn sm', onClick: () => upd({ description: desc }) }, 'Save description'))),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, `Tasks (${i.tasks.filter(t => t.status === 'done').length}/${i.tasks.length})`),
        ...i.tasks.map(t => h('div', { class: 'hrow', style: 'flex-wrap:nowrap' },
          h('select', { class: 'field', style: 'min-height:32px;width:120px;flex:none', 'aria-label': 'Task status', onChange: e => act(() => api('PATCH', `/initiatives/${id}/tasks/${encodeURIComponent(t.id)}`, { status: e.target.value })) }, S.data.enums.taskStatuses.map(s => h('option', { value: s, selected: s === t.status }, TST[s]))),
          h('div', { style: 'flex:1 1 auto;min-width:0' }, h('span', { style: t.status === 'done' ? 'text-decoration:line-through' : '' }, t.title), t.owner ? h('span', { class: 'muted small' }, ' · ' + t.owner) : null, t.due ? h('span', { class: 'muted small' }, ' · due ' + t.due) : null),
          h('button', { class: 'btn sm', 'aria-label': 'Remove task', onClick: () => act(() => api('DELETE', `/initiatives/${id}/tasks/${encodeURIComponent(t.id)}`)) }, 'Remove'))),
        i.tasks.length ? null : empty('No tasks yet.'),
        h('div', { class: 'hrow' }, h('input', { class: 'field', style: 'flex:1 1 200px', 'aria-label': 'New task', placeholder: 'New task', onInput: e => tTitle = e.target.value }), h('input', { class: 'field', style: 'width:120px', 'aria-label': 'Task owner', placeholder: 'Owner', onInput: e => tOwner = e.target.value }),
          h('button', { class: 'btn', onClick: () => tTitle.trim() && act(() => api('POST', `/initiatives/${id}/tasks`, { title: tTitle, owner: tOwner })) }, 'Add'))),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Links'),
        ...i.links.map(l => h('div', { class: 'hrow', style: 'flex-wrap:nowrap' }, h('a', { href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer', style: 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere' }, l.label), h('span', { class: 'source' }, l.source),
          h('button', { class: 'btn sm', 'aria-label': 'Remove link', onClick: () => act(() => api('DELETE', `/initiatives/${id}/links?url=${encodeURIComponent(l.url)}`)) }, 'Remove'))),
        i.links.length ? null : empty('No links yet.'),
        h('div', { class: 'hrow' }, h('input', { class: 'field', style: 'flex:1 1 140px', 'aria-label': 'Link label', placeholder: 'Label', onInput: e => lLabel = e.target.value }), h('input', { class: 'field', style: 'flex:2 1 200px', 'aria-label': 'Link URL', placeholder: 'https://…', onInput: e => lUrl = e.target.value }),
          h('button', { class: 'btn', onClick: () => lUrl.trim() && act(() => api('POST', `/initiatives/${id}/links`, { label: lLabel, url: lUrl })) }, 'Add'))),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Log'),
        h('div', { class: 'hrow' }, h('input', { class: 'field', style: 'flex:1 1 220px', 'aria-label': 'New update', placeholder: 'Update from the owner', onInput: e => logText = e.target.value }), h('button', { class: 'btn', onClick: () => logText.trim() && act(() => api('POST', `/initiatives/${id}/log`, { text: logText })) }, 'Post')),
        ...i.log.map(l => h('div', { class: 'logline' }, h('div', { class: 'muted', style: 'font-size:12px' }, l.ts.replace('T', ' ').replace('Z', ''), ' · ', h('span', { class: 'source' }, l.source)), h('div', {}, l.text))),
        i.log.length ? null : empty('Nothing logged.')),
      h('div', { class: 'muted small' }, 'Stored in the vault as ', h('code', {}, `projects/${i.project}/docs/${i.slug}.md`), ' (', h('code', {}, i.node), ').')));
}

function modal() {
  const m = S.modal; if (!m) return null;
  const v = { title: '', description: '', owner: '', effort: '', project: m.project };
  const close = () => { S.modal = null; S.err = ''; render(); };
  const submit = () => act(async () => {
    if (m.kind === 'project') await api('POST', '/projects', v);
    else { const r = await api('POST', '/initiatives', v); S.modal = null; return go(route().view, r.id); }
    S.modal = null;
  });
  return h('div', { class: 'modal' }, h('div', { class: 'card' },
    h('div', { class: 'hrow between' }, h('h3', {}, m.kind === 'project' ? 'New project' : 'New initiative'), h('button', { class: 'btn sm', onClick: close }, 'Cancel')),
    m.kind === 'initiative' ? h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Project'), h('select', { class: 'field', onChange: e => v.project = e.target.value }, S.data.projects.map(p => h('option', { value: p.slug, selected: p.slug === m.project }, p.title)))) : null,
    S.err ? h('div', { class: 'err' }, S.err) : null,
    h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Title'), h('input', { class: 'field', autofocus: true, onInput: e => v.title = e.target.value })),
    h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Description'), h('textarea', { class: 'field', style: 'min-height:80px', onInput: e => v.description = e.target.value })),
    h('div', { class: 'hrow' }, h('label', { class: 'f', style: 'flex:1 1 160px' }, h('span', { class: 'lbl' }, 'Owner'), h('input', { class: 'field', onInput: e => v.owner = e.target.value })),
      m.kind === 'initiative' ? h('label', { class: 'f' }, h('span', { class: 'lbl' }, 'Effort'), h('select', { class: 'field', onChange: e => v.effort = e.target.value }, ['', ...S.data.enums.efforts].map(x => h('option', { value: x }, x || '–')))) : null),
    h('button', { class: 'btn pri', onClick: submit }, 'Create')));
}

// ---- shell
function render() {
  if (!S.data) { app.replaceChildren(h('div', { class: 'wrap muted' }, S.err || 'Loading…')); return; }
  const { view, open } = route(), a = document.activeElement, key = a && a.dataset && a.dataset.k, pos = a && a.selectionStart;
  const c = cyc(cur()), body = { overview, projects, backlog, plan, history, settings }[view]();
  document.title = `${S.data.brand} · ${S.data.config.title}`;
  app.replaceChildren(...[
    h('div', { class: 'top' }, h('div', { class: 'wrap' },
      h('div', {}, h('div', { style: 'font-size:20px;font-weight:700' }, S.data.config.title === 'Tempo' ? 'Tempo' : S.data.config.title), h('div', { class: 'muted', style: 'font-size:13px' }, S.data.current < 0 ? `Cycle 0 starts ${cyc(0).start}` : `${c.name} · ${c.start} → ${c.end}`)),
      h('nav', { class: 'hrow' }, TABS.map(([k, l]) => h('button', { class: 'btn' + (k === view ? ' on' : ''), onClick: () => go(k) }, l)), h('button', { class: 'btn pri', onClick: () => { const p = S.data.projects[0]; S.modal = p ? { kind: 'initiative', project: p.slug } : { kind: 'project' }; render(); } }, 'New initiative')))),
    h('div', { class: 'wrap main' }, S.err && !open && !S.modal ? h('div', { class: 'err' }, S.err) : null, body),
    open ? drawer(open) : null, modal()].filter(Boolean));
  if (key) { const el = app.querySelector(`[data-k="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* selects have no range */ } } }
}

load().catch(e => { S.err = e.message; render(); });

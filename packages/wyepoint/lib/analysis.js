'use strict';
// What the planner works out from the vault: each initiative's tier, planner checks and progress, each person's load,
// the checks on the plan being built, the simulation of a new idea, and the prompts the status agents are given.
// It runs on the server so the page cannot hand an agent a prompt of its own.
const DAY = 86400000;

const LABEL = { 'on-track': 'On Track', 'at-risk': 'At Risk', 'off-track': 'Off Track', 'not-started': 'Not Started', complete: 'Shipped', paused: 'Paused' };
const CLASS = { 'on-track': 's-on', 'at-risk': 's-risk', 'off-track': 's-off', 'not-started': 's-ns', complete: 's-ship', paused: 's-none' };
const TIER_LABEL = (tier, active) => ({ cycle: 'Cycle ' + active, plan: 'Planned', done: 'Shipped, past cycle', carry: 'Carry-over', next: 'Next cycle', later: 'Later', icebox: 'Icebox', proposed: 'Proposed' }[tier] || tier);
const TIER_ORDER = { cycle: 0, plan: 1, next: 2, later: 3, icebox: 4, proposed: 5, carry: 6, done: 7 };
const STATUS_ORDER = { 'off-track': 0, 'at-risk': 1, 'on-track': 2, 'not-started': 3, paused: 4, complete: 5 };
const EFFORT_ORDER = { S: 1, M: 2, L: 3, XL: 4 };

const utc = d => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const iso = d => d.toISOString().slice(0, 10);
function parseDate(s) {
  if (!s) return null;
  let m = /(\d{4})-(\d\d)-(\d\d)/.exec(s); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); if (m) return new Date(Date.UTC(m[3].length < 4 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
  return null;
}
const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- context: the active cycle, the next one, and today
function context(store, today = new Date()) {
  const recs = store.cycleRecords(), active = store.activeN(recs), cfg = store.config();
  const cyc = n => store.cycle(n, recs, active);
  return { cfg, recs, active, cyc, A: cyc(active), nx: cyc(active + 1), today: utc(today), todayIso: iso(utc(today)), directory: store.people(), projects: store.projects() };
}
const stLabel = (it, tier) => LABEL[it.status] || (tier === 'cycle' ? 'No status' : tier === 'plan' ? 'Planned' : tier === 'proposed' ? 'Proposed' : 'Backlog');

function tierOf(it, active) {
  if (it.cycle == null) return it.bucket || 'proposed';
  if (it.cycle === active) return 'cycle';
  if (it.cycle > active) return 'plan';
  return it.status === 'complete' ? 'done' : 'carry';
}

function progress(it, tier, ctx) {
  if (it.tasks.length) {
    const v = it.tasks.reduce((s, t) => s + (t.status === 'done' ? 1 : t.status === 'in-progress' || t.status === 'review' ? 0.5 : 0), 0);
    return { p: Math.round(v / it.tasks.length * 100), basis: `${it.tasks.filter(t => t.status === 'done').length} of ${it.tasks.length} milestones done` };
  }
  if (tier === 'done') return { p: 100, basis: `Shipped in Cycle ${it.cycle}` };
  if (tier !== 'cycle') return { p: 0, basis: tier === 'carry' ? 'Carried over, not shipped' : 'Not in a cycle yet' };
  const s = parseDate(ctx.A.start), e = parseDate(ctx.A.end), el = Math.max(0, Math.min(1, (ctx.today - s) / (e - s || 1)));
  const p = { complete: 100, 'on-track': Math.round(el * 100), 'at-risk': Math.round(el * 70), 'off-track': Math.round(el * 40), 'not-started': 0 }[it.status];
  return { p: p === undefined ? 0 : p, basis: 'Estimate from status and time elapsed; add milestones for a real number' };
}

function flagsFor(it, tier, ctx) {
  if (tier !== 'cycle') return [];
  const f = [], d = parseDate(it.target), end = parseDate(ctx.A.end);
  if (!it.owner) f.push('No named champion');
  if (!it.status) f.push('No status set');
  if (!it.target) f.push('No target ship date');
  else if (d && d < ctx.today && it.status !== 'complete') f.push(`Target date ${it.target} has passed and it is not shipped`);
  else if (d && d > end) f.push(`Target date ${it.target} is after the cycle ends (${fmt(end)})`);
  if (it.status === 'off-track') f.push('Off track');
  if (it.status === 'at-risk') f.push('At risk');
  if (!it.ships) f.push('No "what ships" description');
  if (!it.effort) f.push('No effort size');
  return f;
}

function decorate(it, ctx) {
  const tier = tierOf(it, ctx.active), pr = progress(it, tier, ctx), project = (ctx.projects.find(p => p.slug === it.project) || { title: it.project }).title;
  return { ...it, projectTitle: project, tier, tierLabel: TIER_LABEL(tier, ctx.active), statusLabel: stLabel(it, tier), statusClass: CLASS[it.status] || 's-none', flags: flagsFor(it, tier, ctx), progress: pr.p, progressBasis: pr.basis, hot: it.status === 'off-track' || it.status === 'at-risk' };
}

// ---- people: a champion is worth 2, a contributor 1, on unshipped items of the active cycle. Everyone in the directory
// is here, and so is anyone an initiative names who is not in it yet (they can be added from their panel).
function peopleOf(items, directory) {
  const P = {}, key = n => n.toLowerCase();
  const get = n => (P[key(n)] = P[key(n)] || { n, ch: [], co: [], inDirectory: false, slug: '', role: '', team: '', email: '', source: '' });
  directory.forEach(d => Object.assign(get(d.name), { n: d.name, inDirectory: true, slug: d.slug, role: d.role, team: d.team, email: d.email, source: d.source }));
  items.forEach(it => { if (it.owner) get(it.owner).ch.push(it.id); it.contributors.forEach(n => { if (key(n) !== key(it.owner || '')) get(n).co.push(it.id); }); });
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const live = id => { const i = byId[id]; return i && i.tier === 'cycle' && i.status !== 'complete'; };
  return Object.values(P).map(p => {
    const c = p.ch.filter(live).length, k = p.co.filter(live).length, score = c * 2 + k;
    const tag = !p.ch.length && !p.co.length ? ['Has room', 's-ship'] : score >= 10 ? ['Overloaded', 's-off'] : score >= 6 ? ['Heavy', 's-risk'] : !p.ch.length ? ['Contributor only', 's-ns'] : ['Balanced', 's-on'];
    return { ...p, load: { active: c + k, score, c, k }, tag: tag[0], tagClass: tag[1] };
  }).sort((a, b) => b.load.score - a.load.score || a.n.localeCompare(b.n));
}

// What else a person is linked to: milestones they own, risks they are responsible for, goals they own, and a history of
// where they took part (closed cycles, and updates that name them). These are the same references the pages hold for Wye
// (owner on a milestone, `responsible: person:<slug>` on a risk, the owner of a goal), read from the pages.
function linksOf(p, items, goals, recs) {
  const me = p.n.toLowerCase(), ref = p.slug ? `person:${p.slug}` : '';
  const mine = v => !!v && (String(v).toLowerCase() === me || (!!ref && v === ref));
  const milestones = [], risks = [], history = [];
  for (const it of items) {
    for (const t of it.tasks) if (mine(t.owner)) milestones.push({ key: t.key || '', title: t.title, status: t.status, due: t.due || '', project: it.id, projectTitle: it.title });
    for (const n of it.nodes || []) { const pr = n.props || {}; if (mine(pr.responsible)) risks.push({ key: pr.key || '', kind: n.kind, title: n.text, status: n.status, severity: pr.severity || '', project: it.id, projectTitle: it.title }); }
    for (const l of it.log) if (l.text.toLowerCase().includes(me)) history.push({ kind: 'update', ts: l.ts, text: l.text, source: l.source, project: it.id, projectTitle: it.title });
  }
  for (const r of Object.values(recs || {})) for (const s of r.snap || []) if (String(s.champion).toLowerCase() === me) history.push({ kind: 'cycle', ts: r.closedAt || r.end || '', cycle: r.n, title: s.title, status: s.status, pct: s.pct, project: s.id });
  history.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return { milestones, risks, goals: goals.filter(g => String(g.owner).toLowerCase() === me).map(g => ({ slug: g.slug, key: g.key, title: g.title, status: g.status })), history: history.slice(0, 40) };
}

// ---- the plan being built for the next cycle
function planChecks(planned, people, nxN) {
  const out = [], perProject = {};
  planned.forEach(i => { perProject[i.projectTitle] = (perProject[i.projectTitle] || 0) + 1; });
  Object.entries(perProject).forEach(([w, n]) => { if (n > 6) out.push(`${w} has ${n} ranked items; the cap is 6`); });
  const xl = planned.filter(i => i.effort === 'XL');
  if (xl.length > 1) out.push('More than one XL item is planned');
  else if (xl.length === 1 && planned.length >= 4) out.push('An XL item plus 3 or more other ranked items is overcommitted');
  const noCh = planned.filter(i => !i.owner); if (noCh.length) out.push(`${noCh.length} planned item(s) have no champion: ${noCh.slice(0, 3).map(i => i.title).join('; ')}`);
  const un = planned.filter(i => !i.approved); if (un.length) out.push(`${un.length} planned item(s) are no longer approved`);
  const load = {};
  planned.forEach(i => { if (i.owner) (load[i.owner] = load[i.owner] || { c: 0, k: 0 }).c++; i.contributors.forEach(n => { if (n !== i.owner) (load[n] = load[n] || { c: 0, k: 0 }).k++; }); });
  Object.entries(load).forEach(([n, l]) => { if (l.c * 2 + l.k >= 8) out.push(`${n} would carry ${l.c} champion and ${l.k} contributor slots in Cycle ${nxN}`); });
  return out;
}

// ---- everything the page needs, in one pass
function analyze(store, today) {
  const ctx = context(store, today), items = store.initiatives().map(i => decorate(i, ctx));
  const planned = items.filter(i => i.tier === 'plan').sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const goals = store.goals(), people = peopleOf(items, ctx.directory).map(p => ({ ...p, links: linksOf(p, items, goals, ctx.recs) })), nx = ctx.nx;
  const cycles = [];
  for (let n = 0; n <= Math.max(ctx.active + ctx.cfg.horizon, 3); n++) cycles.push(ctx.cyc(n));
  const inPlan = planned.filter(i => i.cycle === nx.n);
  const checks = planChecks(inPlan, people, nx.n);
  return {
    ctx, items, people, planned: inPlan, cycles, checks,
    canRelease: nx.status === 'planned' && inPlan.length > 0 && inPlan.every(i => i.approved),
  };
}

// ---- simulate: who and what a new idea touches (deterministic; the agent writes the briefing from this)
const STOP = new Set('the and for with that this from into will have are new add more their they when what while using use customers customer support enable improve'.split(' '));
const tokens = text => [...new Set(((text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(w => !STOP.has(w)))];
function simulate(a, input) {
  const toks = tokens(`${input.title || ''} ${input.description || ''}`);
  const scored = a.items.filter(it => it.id !== input.exclude).map(it => {   // an initiative being simulated is not related to itself
    const hay = `${it.title} ${it.projectTitle} ${it.ships} ${it.risks} ${it.description}`.toLowerCase(); let sc = 0;
    toks.forEach(w => { if (hay.includes(w)) sc += it.title.toLowerCase().includes(w) ? 3 : 1; });
    if (it.tier === 'cycle') sc *= 1.2;
    return { it, sc };
  }).filter(x => x.sc > 0).sort((x, y) => y.sc - x.sc).slice(0, 10);
  const wsScore = {}; scored.forEach(x => { wsScore[x.it.projectTitle] = (wsScore[x.it.projectTitle] || 0) + x.sc; });
  const ps = {}, why = {};
  scored.forEach(x => {
    const add = (n, w, role) => { if (!n) return; ps[n] = (ps[n] || 0) + w * x.sc; (why[n] = why[n] || []).push(`${role}: ${x.it.title}`); };
    add(x.it.owner, 3, 'champion'); x.it.contributors.forEach(n => add(n, 1, 'contributor'));
  });
  const byName = Object.fromEntries(a.people.map(p => [p.n, p]));
  const people = Object.keys(ps).sort((x, y) => ps[y] - ps[x]).slice(0, 8).map(n => { const p = byName[n]; return { n, why: (why[n] || []).slice(0, 2).join(' | '), tag: p.tag, tagClass: p.tagClass, load: p.load.score, active: p.load.active }; });
  const affected = Object.keys(wsScore).sort((x, y) => wsScore[y] - wsScore[x]).slice(0, 3);
  const bump = a.items.filter(i => i.tier === 'cycle' && affected.includes(i.projectTitle) && ['not-started', 'at-risk', 'off-track'].includes(i.status)).slice(0, 10).map(i => ({ t: i.title, project: i.projectTitle, status: i.statusLabel, champion: i.owner }));
  return { people, items: scored.map(x => x.it.id), related: scored.map(x => ({ t: x.it.title, project: x.it.projectTitle, status: x.it.statusLabel, tier: x.it.tier, champion: x.it.owner })), bump };
}

// ---- prompts. Facts only from the vault; the agent is told to say what it cannot tell.
const ctxText = (a, what) => `You are the ${what} for the "${a.ctx.cfg.title}" ${a.ctx.cfg.weeks}-week planner. Today is ${a.ctx.todayIso}. Cycle ${a.ctx.active} (${a.ctx.A.start} to ${a.ctx.A.end}) is the active ${a.ctx.cfg.weeks}-week cycle${a.ctx.cfg.cooldown ? `, followed by a ${a.ctx.cfg.cooldown}-day cooldown` : ''}; Cycle ${a.ctx.nx.n} runs ${a.ctx.nx.start} to ${a.ctx.nx.end}.`;
const J = JSON.stringify;

function itemPrompt(a, id) {
  const it = a.items.find(i => i.id === id); if (!it) return null;
  const same = a.items.filter(x => x.project === it.project && x.id !== it.id && x.tier === 'cycle').map(x => `${x.title} [${x.statusLabel}]`).slice(0, 12);
  return ctxText(a, 'status agent') + ' Rules: the champion updates status weekly, effort is calendar time, unshipped items roll into the next cycle ranking without a free pass, flag cross-team risks early.\n'
    + 'Item: ' + J({ key: it.key, title: it.title, project: it.projectTitle, rank: it.rank, status: it.statusLabel, effort: it.effort, target: it.target, champion: it.owner, contributors: it.contributors, ships: it.ships, risks: it.risks, mission: it.mission, milestones: it.tasks.map(t => `${t.title} [${t.status}${t.due ? ', due ' + t.due : ''}]`), recentLog: it.log.slice(0, 5).map(l => `${l.ts.slice(0, 10)} ${l.text}`) })
    + '\nPlanner checks: ' + J(it.flags) + '\nOther cycle items in the same team: ' + J(same)
    + '\nWrite a status read in under 140 words: (1) health verdict in one line, (2) what looks wrong or stale, (3) the one question to ask the champion this week, (4) likely outcome by the end of the cycle (ship, interim milestone, roll over). Only use facts given; say when something is unknown.';
}
function portfolioPrompt(a) {
  const cyc = a.items.filter(i => i.tier === 'cycle');
  const flagged = cyc.filter(i => i.flags.some(f => !/No effort|what ships/.test(f)));
  const counts = {}; cyc.forEach(i => { counts[i.statusLabel] = (counts[i.statusLabel] || 0) + 1; });
  const byProject = {}; cyc.forEach(i => { byProject[i.projectTitle] = (byProject[i.projectTitle] || 0) + 1; });
  const risky = flagged.filter(i => i.hot).slice(0, 25).map(i => ({ t: i.title, project: i.projectTitle, status: i.statusLabel, champion: i.owner, risks: i.risks }));
  const stale = flagged.filter(i => i.flags.some(f => /has passed/.test(f))).slice(0, 25).map(i => ({ t: i.title, project: i.projectTitle, target: i.target, status: i.statusLabel, champion: i.owner }));
  const load = a.people.slice(0, 10).map(p => ({ n: p.n, score: p.load.score, active: p.load.active }));
  return ctxText(a, 'portfolio status agent') + ' Data: status counts ' + J(counts) + '; ranked items per team ' + J(byProject)
    + '; at-risk or off-track items ' + J(risky) + '; items past target date and not shipped ' + J(stale)
    + '; most loaded people (score = 2 x champion + 1 x contributor on unshipped cycle items) ' + J(load)
    + '. Write a briefing for the Director in under 260 words with short headed sections: Overall, Needs a decision now, Stale or unreliable status, People at risk of overload, What to fix in the planner before cycle close. Use only these facts and name items and people.';
}
function simPrompt(a, input, sim) {
  const when = input.when === 'cycle2' ? 'now, inside the active cycle' : input.when === 'later' ? 'later' : `the next cycle (${a.ctx.nx.start} to ${a.ctx.nx.end})`;
  return ctxText(a, 'simulation agent') + ' Rules: forced rank with no ties, cap of 3-6 ranked items per team, an XL should be the only rank 1, a mid-cycle addition pushes another priority to backlog, effort is calendar time.\n'
    + 'Proposed initiative: ' + J({ title: input.title, description: input.description, effort: input.effort, target: when })
    + '\nMost relevant people with load: ' + J(sim.people.map(r => ({ n: r.n, why: r.why, loadScore: r.load, activeItems: r.active })))
    + '\nRelated initiatives: ' + J(sim.related) + '\nCandidate items to bump or sequence behind (same teams, not yet on track): ' + J(sim.bump)
    + '\nWrite under 260 words with short headed sections: Suggested champion and core team, What it affects (dependencies, overlaps, duplicated work), Capacity impact (who gets stretched, what to bump or defer), Recommended placement (cycle and tier) and the first 2 questions to answer. Use only the facts given and say what you cannot tell.';
}

// the row kept in a closed cycle's snapshot
const snapshotOf = it => ({ id: it.id, rank: it.rank == null ? '' : String(it.rank), status: it.status || '', pct: it.progress, project: it.projectTitle, champion: it.owner, title: it.title });

module.exports = { context, decorate, analyze, simulate, itemPrompt, portfolioPrompt, simPrompt, snapshotOf, parseDate, tierOf, LABEL, CLASS, TIER_ORDER, STATUS_ORDER, EFFORT_ORDER };

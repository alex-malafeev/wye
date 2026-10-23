#!/usr/bin/env node
'use strict';
// Imports a 6-week cycle planning workbook into a WyePoint vault.
//
//   python3 -I scripts/xlsx-to-json.py "plan.xlsx" plan.json
//   node scripts/import-cycle-sheet.js plan.json --vault <new vault dir> [--start 2026-06-15] [--source "name of the file"]
//
// Each team tab is a goal; its rows are projects. A tab that is a plan ("Rank | Initiative | Team | …") has its rows above
// the cut line in the cycle named in its header, and the rest in the backlog; a tab that is a backlog ("Priority Tier |
// Initiative | …") is all backlog. The team column is the area. The example tabs, the instructions and drafts are left out.
const fs = require('fs');
const path = require('path');
const { Store } = require('../lib/store');

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const input = args.find(a => !a.startsWith('--') && a !== opt('--vault') && a !== opt('--start') && a !== opt('--source'));
const vault = opt('--vault');
if (!input || !vault) { console.error('usage: import-cycle-sheet.js <plan.json> --vault <dir> [--start YYYY-MM-DD] [--source <name>]'); process.exit(2); }
if (fs.existsSync(vault) && fs.readdirSync(vault).length) { console.error(`${vault} is not empty; import into a new vault`); process.exit(2); }
const SOURCE = opt('--source', 'the cycle planning workbook');
const CYCLE_START = opt('--start', '2026-06-15');                    // cycle 0 of the formula: cycle n starts n × 49 days later (6 weeks + 1 week of cooldown)
const book = JSON.parse(fs.readFileSync(input, 'utf8'));

// ---------------------------------------------------------------- reading the tabs
const SKIP = [/^How to Use/, /^PM Instructions/, /^Example/, /Proposed$/];                  // instructions, examples, a draft rewrite
const NAMES = { 'Waste IntelligencePassenger Tra': 'Waste Intelligence / Passenger Transit', 'Driver Behavior Detections Back': 'Driver Behavior Detections Backlog', 'HW AIM4Moby': 'HW AIM4 / Moby', 'Sheet5': 'Waste Intelligence / Passenger Transit Backlog' };
const goalOf = tab => (NAMES[tab] || tab).replace(/\s+(Cycle Plan|Plan|Backlog)$/, '').trim();
const clean = s => String(s == null ? '' : s).replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
const oneLine = s => clean(s).replace(/\s+/g, ' ');
const first = s => clean(s).split('\n').map(x => x.trim()).find(Boolean) || '';

// ---------------------------------------------------------------- people
const STOP = new Set(['agent', 'platform', 'pricing', 'finops', 'engineering', 'hw', 'gtm', 'tbd', 'tbh', 'ic', 'tech', 'dri', 'ai', 'fw', 'se', 'partners', 'customer', 'suppliers', 'maps', 'ml', 'cv', 'science', 'team', 'needed', 'contributors', 'pilot', 'champions', 'pm', 'owns', 'development', 'work', 'air', 'cover', 'ownership', 'handoff', 'data', 'pipeline', 'install', 'detections', 'as', 'from', 'full-stack', 'platform-side', 'eng', 'engineer', 'engineers', 'backend', 'firmware', 'infra', 'advisory']);
const NAME_WORD = /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’\-.]*$/;
const known = new Map();                                                                         // lowercased full name → name
const emails = new Map();
const seen = new Set();                                                                              // every name that appears, as typed
const INITIAL = /^[A-Z]\.\s/;
const addKnown = n => { if (!n || INITIAL.test(n)) return n; if (!known.has(n.toLowerCase())) known.set(n.toLowerCase(), n); return known.get(n.toLowerCase()); };
const isName = w => NAME_WORD.test(w) && !STOP.has(w.toLowerCase().replace(/[.,]/g, ''));
const withInitial = tok => {                                                                       // "D. Conde" is a person already known by a longer name
  const m = /^([A-Z])\.\s*(\S+)$/.exec(tok); if (!m) return null;
  return [...known.values()].find(n => n[0] === m[1] && n.split(' ').slice(1).includes(m[2])) || null;
};
// the people named in a cell: whole names already known first, then what is left, in pairs ("Vadym Dragan"); the rest is text
function peopleIn(cell, { learn = false } = {}) {
  let text = clean(cell).replace(/\([^)]*\)?/g, ' ').replace(/->.*$/gm, ' ').replace(/:\s*\d+%/g, ' ');
  const out = [], rest = [];
  const email = /([\w.+-]+)@[\w.-]+/.exec(text);
  if (email) { const nm = email[1].split(/[._]/).map(w => w[0].toUpperCase() + w.slice(1)).join(' '); const n = addKnown(nm); emails.set(n, email[0]); out.push(n); text = text.replace(email[0], ' '); }
  for (const seg of text.split(/[,;\n/+]|\band\b|\s-\s/).map(s => s.trim()).filter(Boolean)) {
    if (/^(tbd|tbh|n\/a|na|none)\b/i.test(seg)) { rest.push(seg); continue; }
    let toks = seg.split(/\s+/); const run = [];
    const flush = () => {
      if (!run.length) return;
      const words = run.join(' ').replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2').split(/\s+/);       // names run together: "Bill MarinoMikhail Prosalov"
      if (run.length === 1 && words.length === 1) { out.push(learn ? addKnown(words[0]) : words[0]); }
      else if (words.length % 2 === 0) { for (let k = 0; k < words.length; k += 2) out.push(learn ? addKnown(words.slice(k, k + 2).join(' ')) : words.slice(k, k + 2).join(' ')); }
      else if (words.length === 3 && run.length === 3) out.push(learn ? addKnown(words.join(' ')) : words.join(' '));
      else rest.push(run.join(' '));
      run.length = 0;
    };
    for (let i = 0; i < toks.length;) {
      let hit = null;
      for (let len = Math.min(4, toks.length - i); len >= (toks.length === 1 ? 1 : 2) && !hit; len--) { const cand = toks.slice(i, i + len).join(' '); if (known.has(cand.toLowerCase())) hit = [known.get(cand.toLowerCase()), len]; }
      const ini = !hit && /^[A-Z]\.$/.test(toks[i]) && toks[i + 1] ? withInitial(toks[i] + ' ' + toks[i + 1]) : null;
      if (hit) { flush(); out.push(hit[0]); i += hit[1]; }
      else if (ini) { flush(); out.push(ini); i += 2; }
      else if (isName(toks[i])) { run.push(toks[i]); i++; }
      else { flush(); rest.push(toks[i]); i++; }
    }
    flush();
  }
  out.forEach(n => seen.add(n));
  return { people: [...new Set(out)], rest: rest.join(' ').replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------- the rows of a tab
const serial = v => { const n = +v; if (!(n > 30000 && n < 80000)) return ''; return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10); };
const mdy = s => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s)); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
const STATUS = { 'on track': ['on-track'], 'not started': ['not-started'], shipped: ['complete'], 'at risk': ['at-risk'], 'off track': ['off-track'], 'approved / gated': ['not-started', 'Approved / Gated'], 'in progress / high priority': ['on-track', 'In progress / high priority'], 'open decision / critical': ['at-risk', 'Open decision / critical'] };
const AREA_FIX = { Safe: 'Safety Product' };
const AREA_OK = t => t && t.length <= 42 && !/[.]$/.test(t) && !/^(use|fold|dates|no current|automation)\b/i.test(t);

function tabInfo(name, rows) {
  const hi = rows.findIndex(r => r[0] && ['Rank', 'Priority Tier'].includes(r[0].trim()));
  if (hi < 0) return null;
  const head = rows[hi].map(c => c.trim()), meta = rows.slice(0, hi).map(r => r.join(' ')).join(' ');
  const cycleN = /Cycle #:\s*(\d+)/.exec(meta), start = /Start Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(meta), theme = /Theme \/ Goal:\s*(.+?)\s*$/m.exec(meta);
  const items = rows.slice(hi + 1).map((r, k) => ({ row: hi + 2 + k, ...Object.fromEntries(head.map((h, i) => [h, clean(r[i])])) }));
  const plan = head[0] === 'Rank', backlogTab = /(Backlog|\bBack)$/.test(name) || name === 'Sheet5';
  return { name, plan, backlogTab, cycle: cycleN ? +cycleN[1] : null, start: start ? mdy(start[1]) : '', theme: theme ? oneLine(theme[1]).replace(/[:.]$/, '') : '', head, items };
}
const tabs = Object.entries(book).filter(([n]) => !SKIP.some(re => re.test(n))).map(([n, r]) => tabInfo(n, r)).filter(Boolean);
const skipped = Object.keys(book).filter(n => SKIP.some(re => re.test(n)));

// cycle numbers: the sheet's formula puts cycle 1 on 3 Aug 2026; a tab dated before that is cycle 0 or 1 whatever its header says
const dayMs = 864e5, cycleFor = (tab) => { if (!tab.start) return tab.cycle; const d = (Date.parse(tab.start) - Date.parse(CYCLE_START)) / dayMs; return Math.max(0, Math.floor(d / 49)); };

// ---------------------------------------------------------------- learn the names first
for (const t of tabs) for (const it of t.items) peopleIn(it.Champion || '', { learn: true });
for (const t of tabs) for (const it of t.items) peopleIn(it.Contributors || '');                     // (learns nothing; makes the pass below deterministic)
for (const t of tabs) for (const it of t.items) { const c = peopleIn(it.Contributors || '', { learn: false }); c.people.forEach(n => { if (/\s/.test(n)) addKnown(n); }); }

// ---------------------------------------------------------------- build
const store = new Store(vault);
store.setConfig({ title: 'WyePoint', weeks: 6, cooldown: 7, start: CYCLE_START });
const report = { goals: {}, areas: new Set(), people: new Set(), projects: 0, inCycle: 0, backlog: 0, risks: 0, skippedTabs: skipped, notes: [] };
const canon = name => {
  const full = [...seen].filter(n => !INITIAL.test(n) && /\s/.test(n));
  if (INITIAL.test(name)) { const [ini, ...rest] = name.split(/\s+/), sur = rest.join(' '); const m = full.filter(n => n[0] === ini[0] && n.split(' ').slice(1).join(' ').includes(sur)); return m.length === 1 ? m[0] : name; }
  if (!/\s/.test(name)) { const m = full.filter(n => n.split(' ')[0] === name); return m.length === 1 ? m[0] : name; }
  return name;
};
const personCache = new Map();
const person = typed => {
  if (!typed) return '';
  const name = canon(typed);
  if (!personCache.has(name)) { try { store.createPerson({ name, email: emails.get(name) || '', source: 'import' }); } catch { /* there already */ } personCache.set(name, name); report.people.add(name); }
  return name;
};
const areaCache = new Map();
const area = team => {
  let t = oneLine(AREA_FIX[oneLine(team)] || team); if (!AREA_OK(t)) t = 'Safety Product';
  if (!areaCache.has(t)) { areaCache.set(t, store.createProject({ title: t }).slug); report.areas.add(t); }
  return areaCache.get(t);
};
const goalCache = new Map();
const goal = (title, theme) => {
  if (!goalCache.has(title)) { goalCache.set(title, store.createGoal({ title, status: '', description: theme ? `Cycle theme in the sheet: ${theme}.` : '' }).slug); report.goals[title] = { projects: 0, backlog: 0 }; }
  return goalCache.get(title);
};

const section = (name, text) => (clean(text) ? `\n## ${name}\n${clean(text)}\n` : '');
function projectBody(it, extra) {
  const risk = clean(it['Dependencies / Risks']), riskLines = [];
  if (risk && !/^(none( known)?|n\/a|na|-)$/i.test(risk)) {
    const [head, ...more] = risk.split('\n').map(s => s.trim()).filter(Boolean);
    riskLines.push(`- risk:new.1 ${oneLine(head).slice(0, 220)} #open`, ...more.map(l => `  ${l}`)); report.risks++;
  }
  const mission = oneLine(it.Mission);
  return [
    clean(it.Description), '',
    mission && !/^n\/a$/i.test(mission) ? `Mission: ${mission}` : '',
    section('What ships', it["What's Shipping"]),
    section('Definition of done', it['Definition of Done']), section('Success metric', it['Success Metric / KPI']),
    section('Why not this cycle', it['Why Not This Cycle']), section('Notes', it.Notes), section('Tie to the NPI goal', it['Tie to NPI Goal']),
    riskLines.length ? `\n## Risks\n${riskLines.join('\n')}\n` : '', ...extra.map(e => section(e[0], e[1])),
    '\n## Milestones\n\n## Updates\n',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

for (const t of tabs) {
  const g = goalOf(t.name), gslug = goal(g, t.theme), n = cycleFor(t);
  const titles = t.items.map(it => first(it.Initiative)).filter(Boolean), dup = new Set(titles.filter((x, i) => titles.indexOf(x) !== i));
  for (const it of t.items) {
    const ships = first(it["What's Shipping"] || it.Description);
    let title = first(it.Initiative) || ships;
    if (!title) continue;
    if (dup.has(title) && ships && first(it.Initiative)) title = `${title} — ${ships.replace(/^[-•\d.)\s]+/, '').slice(0, 80)}`;
    title = oneLine(title).slice(0, 140);
    const extra = [];
    const theme = clean(it.Initiative).split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim(); if (theme) extra.push(['Theme', theme.replace(/^Theme:\s*/i, '')]);
    // who
    const champ = peopleIn(it.Champion || ''), contrib = peopleIn(it.Contributors || '');
    const owner = champ.people[0] ? person(champ.people[0]) : '';
    const others = [...new Set([...champ.people.slice(1), ...contrib.people].filter(p => p !== owner))].map(person);
    const leftover = [champ.rest, contrib.rest].filter(Boolean).join(' · ');
    if (leftover) extra.push(['Others involved', leftover]);
    // status, effort, dates
    const raw = oneLine(it.Status), st = STATUS[raw.toLowerCase()] || ['', raw];
    if (st[1]) extra.push(['Status in the sheet', st[1]]);
    const effort = ['S', 'M', 'L', 'XL'].includes(oneLine(it.Effort)) ? oneLine(it.Effort) : ''; if (!effort && oneLine(it.Effort)) extra.push(['Effort in the sheet', oneLine(it.Effort)]);
    const tgtRaw = clean(it['Target Ship Date']), cut = /below cut line/i.test(tgtRaw), target = serial(tgtRaw) || mdy(tgtRaw.split('\n')[0]);
    if (tgtRaw && !target && !/cut line/i.test(tgtRaw)) extra.push(['Target in the sheet', tgtRaw]);
    const rankRaw = oneLine(it.Rank), rank = /^\d+(\.\d+)?$/.test(rankRaw) ? Math.round(+rankRaw) : null;
    const tier = oneLine(it['Priority Tier']);
    // where it belongs: the cycle, or the backlog
    let cycle = null, bucket = 'proposed', approved = false;
    if (t.plan && !t.backlogTab && !cut && n != null) { cycle = n; approved = true; }
    else {
      bucket = t.plan ? (/^P[01]$/i.test(rankRaw) || cut ? 'next' : 'later') : ({ 'next cycle': 'next', later: 'later', icebox: 'icebox' }[tier.toLowerCase()] || 'later');
      if (cut) extra.push(['Below the cut line', `Ranked ${rankRaw || '?'} in ${g}'s plan for cycle ${n}, below the cut line: not committed this cycle.`]);
      else if (t.plan && rankRaw) extra.push(['Priority in the sheet', rankRaw]);
    }
    const area_ = area(it.Team);
    const body = projectBody(it, extra);
    const p = store.createInitiative({ project: area_, title, goal: gslug, owner, contributors: others, status: st[0], effort, target, cycle, rank: cycle != null ? rank : null, approved, bucket, body });
    store.addLog(p.id, { text: `Imported from ${SOURCE}, tab "${t.name}", row ${it.row}`, source: 'import' });
    report.projects++; if (cycle != null) { report.inCycle++; report.goals[g].projects++; } else { report.backlog++; report.goals[g].backlog++; }
  }
}

// the cycles: the short kick-off cycle, the first, and the one the plan is for
const theme = Object.entries(tabs.filter(t => t.plan && !t.backlogTab && t.theme).reduce((m, t) => (m[t.theme] = (m[t.theme] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0];
// their dates are the ones in the workbook's own timeline (PM Instructions), as the cycles are not all the same length (cycle 0 is a short kick-off)
const today = new Date().toISOString().slice(0, 10);
for (const r of (book['PM Instructions'] || [])) {
  const m = /^Cycle (\d+)/.exec(r[1] || ''), start = serial(r[2]), end = serial(r[3]);
  if (m && start && end) store.saveCycle(+m[1], { start, end, ...(end < today && +m[1] < 2 ? { status: 'closed' } : {}), ...(+m[1] === 0 ? { theme: 'Kick-off' } : {}) });
}
if (theme) store.saveCycle(2, { theme: theme[0] });

console.log(JSON.stringify({ ...report, areas: [...report.areas], people: report.people.size, cycleTheme: theme && theme[0], tabs: tabs.map(t => `${t.name} → ${goalOf(t.name)} (${t.plan ? 'plan' : 'backlog'}${t.backlogTab ? ', backlog tab' : ''}, cycle ${cycleFor(t)})`) }, null, 1));

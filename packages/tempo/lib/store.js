'use strict';
// Tempo's storage is a Wye vault: a product folder of Markdown (the vault is the database, no other store).
//   <vault>/_product.md                      the workspace and the cycle settings (cycle-weeks, cycle-start, cycle-cooldown)
//   <vault>/_roster.md                       everyone on the team, one name per line (people with no initiative yet)
//   <vault>/cycles/<n>.md                    what is recorded about one cycle: status, theme, dates, the snapshot taken at close
//   <vault>/projects/<p>/_project.md         a project (what the planner calls a workstream)
//   <vault>/projects/<p>/docs/<slug>.md      an initiative: a page that is a goal node, its tasks and milestones as task
//                                            lines between <!-- tasks --> markers — graph nodes `wye build` and
//                                            `wye query` read like any other page.
const fs = require('fs');
const path = require('path');
const cyclesLib = require('./cycles');

const STATUSES = ['not-started', 'on-track', 'at-risk', 'off-track', 'paused', 'complete'];
const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'];
const EFFORTS = ['S', 'M', 'L', 'XL'];
const BUCKETS = ['proposed', 'next', 'later', 'icebox'];       // where an initiative waits while it has no cycle

const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled';
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const prop = s => oneLine(s).replace(/[,()]/g, ' ');           // a value inside a `(key: value, …)` group
const block = s => String(s || '').trim().replace(/^#{1,2} /gm, '### ');   // free text that must not open a section
const now = () => new Date().toISOString().slice(0, 16) + 'Z';
const day = () => new Date().toISOString().slice(0, 10);
const isDate = s => /^\d{4}-\d\d-\d\d$/.test(s);
const names = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(oneLine).filter(Boolean).filter((n, i, a) => a.indexOf(n) === i);

// ---- frontmatter: flat `key: value` lines
function splitFm(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
  return { fm, body: md.slice(m[0].length) };
}
const joinFm = (fm, body) => '---\n' + Object.entries(fm).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${/[:#]/.test(String(v)) && k === 'title' ? JSON.stringify(v) : v}`).join('\n') + '\n---\n' + body;
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function notFound(what) { return Object.assign(new Error(`${what} not found`), { status: 404 }); }

function sectionsOf(body) {
  const out = { _intro: '' }; let cur = '_intro';
  for (const line of body.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) { cur = h[1]; out[cur] = ''; continue; }
    if (cur === '_intro' && /^# /.test(line)) continue;       // the title line
    out[cur] += line + '\n';
  }
  return out;
}

class Store {
  constructor(dir) { this.dir = path.resolve(dir); this.init(); }
  get productFile() { return path.join(this.dir, '_product.md'); }

  init() {
    if (fs.existsSync(this.productFile)) return;
    write(this.productFile, joinFm({ title: 'Tempo', icon: '🧭', description: 'Projects and initiatives planned in cycles.', 'cycle-weeks': 6, 'cycle-start': day(), 'cycle-cooldown': 7 }, ''));
  }

  // ---- config
  config() {
    const { fm } = splitFm(read(this.productFile));
    return { title: fm.title || 'Tempo', weeks: Math.max(1, +fm['cycle-weeks'] || 6), start: fm['cycle-start'] || day(), cooldown: Math.max(0, +fm['cycle-cooldown'] || 0) };
  }
  setConfig(c) {
    const { fm, body } = splitFm(read(this.productFile));
    if (c.title !== undefined) { const t = oneLine(c.title); if (!t) throw bad('title is required'); fm.title = t; }
    if (c.weeks != null) { const w = Math.round(+c.weeks); if (!(w >= 1 && w <= 26)) throw bad('weeks must be 1–26'); fm['cycle-weeks'] = w; }
    if (c.cooldown != null) { const w = Math.round(+c.cooldown); if (!(w >= 0 && w <= 60)) throw bad('cooldown must be 0–60 days'); fm['cycle-cooldown'] = w; }
    if (c.start != null) { if (!isDate(c.start)) throw bad('start must be YYYY-MM-DD'); fm['cycle-start'] = c.start; }
    write(this.productFile, joinFm(fm, body));
    return this.config();
  }

  // ---- roster
  roster() { return names(read(path.join(this.dir, '_roster.md')).split('\n')); }
  setRoster(list) { write(path.join(this.dir, '_roster.md'), names(list).join('\n') + '\n'); return this.roster(); }

  // ---- cycles. Dates come from the settings; a record under cycles/ overrides them and holds the status, the
  // theme and the snapshot. Without a record a cycle is closed before the active one and planned after it.
  cycleRecords() {
    const out = {};
    let files = []; try { files = fs.readdirSync(path.join(this.dir, 'cycles')).filter(f => /^\d+\.md$/.test(f)); } catch { /* none */ }
    for (const f of files) {
      const { fm, body } = splitFm(read(path.join(this.dir, 'cycles', f)));
      const snap = [];
      for (const line of (sectionsOf(body).Snapshot || '').split('\n')) {
        const m = /^- (\S+) · (\S*) · (\S*) · (\d+) · (.*?) · (.*?) · (.*)$/.exec(line);
        if (m) snap.push({ id: m[1], rank: m[2], status: m[3], pct: +m[4], project: m[5], champion: m[6], title: m[7] });
      }
      out[+fm.n] = { n: +fm.n, status: fm.status || '', theme: fm.theme || '', start: fm.start || '', end: fm.end || '', releasedAt: fm['released-at'] || '', closedAt: fm['closed-at'] || '', snap };
    }
    return out;
  }
  activeN(recs = this.cycleRecords()) {
    const act = Object.values(recs).filter(r => r.status === 'active').map(r => r.n);
    return act.length ? Math.max(...act) : Math.max(0, cyclesLib.cycleAt(this.config()));
  }
  cycle(n, recs = this.cycleRecords(), active = this.activeN(recs)) {
    const d = cyclesLib.cycleOf(this.config(), n), r = recs[n] || {};
    return { n, name: `Cycle ${n}`, start: r.start || d.start, end: r.end || d.end, cooldownEnd: d.cooldownEnd, theme: r.theme || '', status: r.status || (n < active ? 'closed' : n === active ? 'active' : 'planned'), releasedAt: r.releasedAt || '', closedAt: r.closedAt || '', snap: r.snap || [] };
  }
  saveCycle(n, patch) {
    n = Math.round(+n); if (!(n >= 0 && n < 1000)) throw bad('bad cycle');
    const recs = this.cycleRecords(), cur = { ...this.cycle(n, recs), ...(recs[n] || {}) };
    for (const k of ['theme', 'start', 'end', 'status', 'releasedAt', 'closedAt', 'snap']) if (patch[k] !== undefined) cur[k] = patch[k];
    if (cur.theme) cur.theme = oneLine(cur.theme);
    if (patch.start !== undefined && patch.start !== '' && !isDate(patch.start)) throw bad('start must be YYYY-MM-DD');
    if (patch.end !== undefined && patch.end !== '' && !isDate(patch.end)) throw bad('end must be YYYY-MM-DD');
    const snap = (cur.snap || []).map(x => `- ${x.id} · ${x.rank || ''} · ${x.status || ''} · ${x.pct || 0} · ${prop(x.project)} · ${prop(x.champion)} · ${oneLine(x.title)}`);
    write(path.join(this.dir, 'cycles', `${n}.md`), joinFm({ n, type: 'doc', title: `Cycle ${n}`, status: patch.status !== undefined ? patch.status : recs[n] && recs[n].status, theme: cur.theme, start: patch.start !== undefined ? patch.start : recs[n] && recs[n].start, end: patch.end !== undefined ? patch.end : recs[n] && recs[n].end, 'released-at': cur.releasedAt, 'closed-at': cur.closedAt }, `# Cycle ${n}\n\n## Snapshot\n${snap.join('\n')}\n`));
  }

  // ---- projects
  projectsDir() { return path.join(this.dir, 'projects'); }
  projects() {
    let dirs = []; try { dirs = fs.readdirSync(this.projectsDir(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* none yet */ }
    return dirs.sort().map(slug => {
      const { fm, body } = splitFm(read(path.join(this.projectsDir(), slug, '_project.md')));
      return { slug, title: fm.title || slug, description: oneLine(fm.description) || oneLine(body), owner: fm.owner || '' };
    });
  }
  createProject({ title, description = '', owner = '' }) {
    title = oneLine(title); if (!title) throw bad('title is required');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(path.join(this.projectsDir(), s)));
    write(path.join(this.projectsDir(), slug, '_project.md'), joinFm({ title, kind: 'project', owner: oneLine(owner), description: oneLine(description) }, ''));
    fs.mkdirSync(path.join(this.projectsDir(), slug, 'docs'), { recursive: true });
    return this.projects().find(p => p.slug === slug);
  }
  updateProject(slug, patch) {
    const file = path.join(this.projectsDir(), String(slug).replace(/[^\w-]/g, ''), '_project.md');
    if (!fs.existsSync(file)) throw notFound('project');
    const { fm, body } = splitFm(read(file));
    for (const k of ['title', 'description', 'owner']) if (patch[k] !== undefined) fm[k] = oneLine(patch[k]);
    write(file, joinFm(fm, body));
    return this.projects().find(p => p.slug === slug);
  }
  uniqueSlug(base, taken) { let s = base, i = 2; while (taken(s)) s = `${base}-${i++}`; return s; }

  // ---- initiatives (ids are "<project>/<slug>")
  docFile(id) {
    const [p, s, extra] = String(id).split('/');
    if (!p || !s || extra !== undefined || !/^[\w-]+$/.test(p) || !/^[\w-]+$/.test(s)) throw bad('bad initiative id');
    return path.join(this.projectsDir(), p, 'docs', s + '.md');
  }
  initiatives() {
    const out = [];
    for (const p of this.projects()) {
      const dir = path.join(this.projectsDir(), p.slug, 'docs');
      let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { /* none */ }
      for (const f of files.sort()) { const it = this.parseInitiative(p.slug, f.slice(0, -3), read(path.join(dir, f))); if (it) out.push(it); }
    }
    return out;
  }
  get(id) {
    const file = this.docFile(id); if (!fs.existsSync(file)) throw notFound('initiative');
    const [p, s] = id.split('/'); return this.parseInitiative(p, s, read(file));
  }

  parseInitiative(project, slug, md) {
    const { fm, body } = splitFm(md);
    if (!/^goal:/.test(fm.node || '')) return null;           // a page that is not an initiative
    const sec = sectionsOf(body), lines = k => (sec[k] || '').split('\n');
    const tasks = [], taskRe = /^- (task:[\w.-]+) (.*?) #([\w-]+)(?: \((.*)\))?\s*$/;
    for (const line of lines('Tasks')) {
      const m = taskRe.exec(line); if (!m) continue;
      const props = Object.fromEntries((m[4] || '').split(',').map(x => { const i = x.indexOf(':'); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : null; }).filter(Boolean));
      tasks.push({ id: m[1], title: m[2], status: m[3], owner: props.owner || '', due: props.due || '' });
    }
    const links = [], prs = [], linkRe = /^- \[(.*?)\]\((.*?)\)(?: · (.*))?$/;
    for (const line of lines('Links')) { const m = linkRe.exec(line); if (m) links.push({ label: m[1], url: m[2], source: m[3] || 'manual' }); }
    for (const line of lines('Pull requests')) { const m = linkRe.exec(line); if (m) prs.push({ title: m[1], url: m[2], ts: m[3] || '' }); }
    const log = [], logRe = /^- (\S+) · (\S+) · (.*)$/;
    for (const line of lines('Log')) { const m = logRe.exec(line); if (m) log.push({ ts: m[1], source: m[2], text: m[3] }); }
    log.reverse();                                            // newest first; the file reads oldest first, like any log
    const num = v => (v === undefined || v === '' ? null : +v);
    return {
      id: `${project}/${slug}`, project, slug, node: fm.node, title: fm.title || slug, status: fm.status || '', owner: fm.owner || '',
      contributors: names(fm.contributors), mission: fm.mission || '', effort: fm.effort || '', cycle: num(fm.cycle), rank: num(fm.rank),
      approved: fm.approved === 'true', bucket: fm.bucket || 'proposed', target: fm.target || '',
      description: (sec._intro || '').trim(), ships: (sec['What ships'] || '').trim(), risks: (sec.Risks || '').trim(),
      tasks, links, prs, log, updated: fm.updated || '',
    };
  }

  render(it) {
    const fm = { node: it.node, type: 'doc', title: it.title, status: it.status, owner: it.owner, contributors: it.contributors.join(', '), mission: it.mission, effort: it.effort, cycle: it.cycle == null ? '' : it.cycle, rank: it.rank == null ? '' : it.rank, approved: it.approved ? 'true' : '', bucket: it.cycle == null && it.bucket !== 'proposed' ? it.bucket : '', target: it.target, updated: now() };
    // list items, so each is a node of its own (consecutive plain lines would be one paragraph); part-of ties it to the goal
    const tl = it.tasks.map(t => `- ${t.id} ${t.title} #${t.status} (${[t.owner && `owner: ${prop(t.owner)}`, t.due && `due: ${prop(t.due)}`, `part-of: ${it.node}`].filter(Boolean).join(', ')})`);
    const link = l => `- [${l.label}](${l.url}) · ${l.source}`;
    const body = `# ${it.title}\n\n${block(it.description)}\n\n## What ships\n${block(it.ships)}\n\n## Risks\n${block(it.risks)}\n\n## Links\n${it.links.map(link).join('\n')}\n\n## Pull requests\n${it.prs.map(p => `- [${p.title}](${p.url}) · ${p.ts}`).join('\n')}\n\n## Tasks\n<!-- tasks -->\n${tl.join('\n')}\n<!-- /tasks -->\n\n## Log\n${[...it.log].reverse().map(l => `- ${l.ts} · ${l.source} · ${l.text}`).join('\n')}\n`;
    return joinFm(fm, body);
  }
  save(it) { write(this.docFile(it.id), this.render(it)); return this.get(it.id); }

  createInitiative(o) {
    const { project } = o, title = oneLine(o.title); if (!title) throw bad('title is required');
    if (!this.projects().some(p => p.slug === project)) throw notFound('project');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(this.docFile(`${project}/${s}`)));
    const it = { id: `${project}/${slug}`, slug, project, node: `goal:${project}.${slug}`, title, status: '', owner: '', contributors: [], mission: '', effort: '', cycle: null, rank: null, approved: false, bucket: 'proposed', target: '', description: '', ships: '', risks: '', tasks: [], links: [], prs: [], log: [] };
    this.apply(it, o);                                         // no status-change line for the status it starts with
    it.log.unshift({ ts: now(), source: 'tempo', text: 'Initiative created' });
    return this.save(it);
  }
  apply(it, patch) {
    if (patch.title !== undefined) { it.title = oneLine(patch.title); if (!it.title) throw bad('title is required'); }
    for (const k of ['description', 'ships', 'risks']) if (patch[k] !== undefined) it[k] = String(patch[k]);
    if (patch.owner !== undefined) it.owner = oneLine(patch.owner);
    if (patch.contributors !== undefined) it.contributors = names(patch.contributors);
    if (patch.mission !== undefined) it.mission = oneLine(patch.mission);
    if (patch.target !== undefined) { const t = oneLine(patch.target); if (t && !isDate(t)) throw bad('target must be YYYY-MM-DD'); it.target = t; }
    if (patch.status !== undefined) {
      if (patch.status && !STATUSES.includes(patch.status)) throw bad('unknown status');
      if (patch.status !== it.status && it.log.length) it.log.unshift({ ts: now(), source: patch.source || 'tempo', text: `Status ${it.status || 'none'} → ${patch.status || 'none'}` });
      it.status = patch.status;
    }
    if (patch.effort !== undefined) { if (patch.effort && !EFFORTS.includes(patch.effort)) throw bad('effort must be S, M, L or XL'); it.effort = patch.effort; }
    if (patch.bucket !== undefined) { if (!BUCKETS.includes(patch.bucket)) throw bad('unknown bucket'); it.bucket = patch.bucket; }
    if (patch.cycle !== undefined) it.cycle = patch.cycle === null || patch.cycle === '' ? null : Math.round(+patch.cycle);
    if (patch.rank !== undefined) it.rank = patch.rank === null || patch.rank === '' ? null : Math.round(+patch.rank);
    if (patch.approved !== undefined) it.approved = !!patch.approved;
    return it;
  }
  update(id, patch) { return this.save(this.apply(this.get(id), patch)); }
  remove(id) { fs.unlinkSync(this.docFile(id)); }

  // ---- tasks (milestones), links, pull requests, log
  addTask(id, { title, owner = '', due = '', status = 'todo' }) {
    const it = this.get(id); title = oneLine(title); if (!title) throw bad('title is required');
    if (!TASK_STATUSES.includes(status)) throw bad('unknown task status');
    if (due && !isDate(oneLine(due))) throw bad('due must be YYYY-MM-DD');
    const n = it.tasks.reduce((m, t) => Math.max(m, +(/\.(\d+)$/.exec(t.id) || [0, 0])[1]), 0) + 1;
    it.tasks.push({ id: `task:${it.project}.${it.slug}.${n}`, title, status, owner: oneLine(owner), due: oneLine(due) });
    return this.save(it);
  }
  updateTask(id, taskId, patch) {
    const it = this.get(id), t = it.tasks.find(x => x.id === taskId); if (!t) throw notFound('task');
    if (patch.title !== undefined) t.title = oneLine(patch.title) || t.title;
    if (patch.owner !== undefined) t.owner = oneLine(patch.owner);
    if (patch.due !== undefined) { if (patch.due && !isDate(oneLine(patch.due))) throw bad('due must be YYYY-MM-DD'); t.due = oneLine(patch.due); }
    if (patch.status !== undefined) { if (!TASK_STATUSES.includes(patch.status)) throw bad('unknown task status'); t.status = patch.status; }
    return this.save(it);
  }
  removeTask(id, taskId) { const it = this.get(id); it.tasks = it.tasks.filter(t => t.id !== taskId); return this.save(it); }
  addLink(id, { label, url, source = 'manual' }) {
    if (!/^https?:\/\//i.test(url || '')) throw bad('url must start with http:// or https://');
    const it = this.get(id); url = url.trim().replace(/\)/g, '%29');
    if (it.links.some(l => l.url === url)) return it;          // a source pushing the same link twice adds it once
    it.links.push({ label: oneLine(label).replace(/[[\]]/g, '') || url, url, source: oneLine(source).replace(/\s/g, '-') || 'manual' });
    return this.save(it);
  }
  removeLink(id, url) { const it = this.get(id); it.links = it.links.filter(l => l.url !== url); return this.save(it); }
  addPr(id, { title, url }) {
    if (!/^https?:\/\//i.test(url || '')) throw bad('url must start with http:// or https://');
    const it = this.get(id); url = url.trim().replace(/\)/g, '%29');
    if (it.prs.some(p => p.url === url)) return it;
    it.prs.push({ title: oneLine(title).replace(/[[\]]/g, '') || url, url, ts: day() });
    return this.save(it);
  }
  removePr(id, url) { const it = this.get(id); it.prs = it.prs.filter(p => p.url !== url); return this.save(it); }
  addLog(id, { text, source = 'manual' }) {
    text = oneLine(text); if (!text) throw bad('text is required');
    const it = this.get(id); it.log.unshift({ ts: now(), source: oneLine(source).replace(/\s/g, '-') || 'manual', text });
    return this.save(it);
  }

  isEmpty() { return this.projects().length === 0; }
}

module.exports = { Store, STATUSES, TASK_STATUSES, EFFORTS, BUCKETS, slugify, oneLine };

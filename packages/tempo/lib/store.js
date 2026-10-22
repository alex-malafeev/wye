'use strict';
// Tempo's storage is a Wye vault: a product folder of Markdown (decision: the vault is the database, no other store).
//   <vault>/_product.md                      the workspace and the cycle settings (cycle-weeks, cycle-start, cycle-cooldown)
//   <vault>/projects/<p>/_project.md         a project
//   <vault>/projects/<p>/docs/<slug>.md      an initiative: a page that is a goal node, its tasks as task lines between
//                                            <!-- tasks --> markers, its links and log as lists — all of it graph nodes
//                                            `wye build` / `wye query` read like any other page.
const fs = require('fs');
const path = require('path');

const STATUSES = ['proposed', 'on-track', 'at-risk', 'off-track', 'paused', 'complete'];
const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'];
const EFFORTS = ['S', 'M', 'L', 'XL'];

const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled';
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString().slice(0, 16) + 'Z';

// ---- frontmatter: flat `key: value` lines, every other line kept as it was
function splitFm(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
  return { fm, body: md.slice(m[0].length) };
}
const joinFm = (fm, body) => '---\n' + Object.entries(fm).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${/[:#]/.test(String(v)) && k === 'title' ? JSON.stringify(v) : v}`).join('\n') + '\n---\n' + body;

function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }

class Store {
  constructor(dir) { this.dir = path.resolve(dir); this.init(); }
  get productFile() { return path.join(this.dir, '_product.md'); }

  init() {
    if (fs.existsSync(this.productFile)) return;
    write(this.productFile, joinFm({ title: 'Tempo', icon: '🧭', description: 'Projects and initiatives planned in cycles.', 'cycle-weeks': 6, 'cycle-start': new Date().toISOString().slice(0, 10), 'cycle-cooldown': 7 }, ''));
  }

  // ---- config
  config() {
    const { fm } = splitFm(fs.readFileSync(this.productFile, 'utf8'));
    return { title: fm.title || 'Tempo', weeks: Math.max(1, +fm['cycle-weeks'] || 6), start: fm['cycle-start'] || new Date().toISOString().slice(0, 10), cooldown: Math.max(0, +fm['cycle-cooldown'] || 0) };
  }
  setConfig(c) {
    const { fm, body } = splitFm(fs.readFileSync(this.productFile, 'utf8'));
    if (c.weeks != null) { const w = Math.round(+c.weeks); if (!(w >= 1 && w <= 26)) throw bad('weeks must be 1–26'); fm['cycle-weeks'] = w; }
    if (c.cooldown != null) { const w = Math.round(+c.cooldown); if (!(w >= 0 && w <= 60)) throw bad('cooldown must be 0–60 days'); fm['cycle-cooldown'] = w; }
    if (c.start != null) { if (!/^\d{4}-\d\d-\d\d$/.test(c.start)) throw bad('start must be YYYY-MM-DD'); fm['cycle-start'] = c.start; }
    write(this.productFile, joinFm(fm, body));
    return this.config();
  }

  // ---- projects
  projectsDir() { return path.join(this.dir, 'projects'); }
  projects() {
    let names = []; try { names = fs.readdirSync(this.projectsDir(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* none yet */ }
    return names.sort().map(slug => {
      const { fm, body } = splitFm(read(path.join(this.projectsDir(), slug, '_project.md')));
      return { slug, title: fm.title || slug, description: oneLine(fm.description) || oneLine(body), status: fm.status || 'on-track', owner: fm.owner || '' };
    });
  }
  createProject({ title, description = '', owner = '' }) {
    title = oneLine(title); if (!title) throw bad('title is required');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(path.join(this.projectsDir(), s)));
    write(path.join(this.projectsDir(), slug, '_project.md'), joinFm({ title, kind: 'project', status: 'on-track', owner: oneLine(owner), description: oneLine(description) }, ''));
    fs.mkdirSync(path.join(this.projectsDir(), slug, 'docs'), { recursive: true });
    return this.projects().find(p => p.slug === slug);
  }
  updateProject(slug, patch) {
    const file = path.join(this.projectsDir(), slug, '_project.md');
    if (!fs.existsSync(file)) throw notFound('project');
    const { fm, body } = splitFm(read(file));
    for (const k of ['title', 'description', 'owner']) if (patch[k] !== undefined) fm[k] = oneLine(patch[k]);
    if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) throw bad('unknown status'); fm.status = patch.status; }
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
    const sections = sectionsOf(body);
    const tasks = [], taskRe = /^- (task:[\w.-]+) (.*?) #([\w-]+)(?: \((.*)\))?\s*$/;
    for (const line of (sections.Tasks || '').split('\n')) {
      const m = taskRe.exec(line); if (!m) continue;
      const props = Object.fromEntries((m[4] || '').split(',').map(x => { const i = x.indexOf(':'); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : null; }).filter(Boolean));
      tasks.push({ id: m[1], title: m[2], status: m[3], owner: props.owner || '', due: props.due || '' });
    }
    const links = [], linkRe = /^- \[(.*?)\]\((.*?)\)(?: · (.*))?$/;
    for (const line of (sections.Links || '').split('\n')) { const m = linkRe.exec(line); if (m) links.push({ label: m[1], url: m[2], source: m[3] || 'manual' }); }
    const log = [], logRe = /^- (\S+) · (\S+) · (.*)$/;
    for (const line of (sections.Log || '').split('\n')) { const m = logRe.exec(line); if (m) log.push({ ts: m[1], source: m[2], text: m[3] }); }
    log.reverse();                                            // newest first; the file reads oldest first, like any log
    const done = tasks.filter(t => t.status === 'done').length;
    return {
      id: `${project}/${slug}`, project, slug, node: fm.node, title: fm.title || slug, status: fm.status || 'proposed',
      owner: fm.owner || '', effort: fm.effort || '', cycle: fm.cycle === undefined || fm.cycle === '' ? null : +fm.cycle,
      rank: fm.rank === undefined || fm.rank === '' ? null : +fm.rank, approved: fm.approved === 'true', due: fm.target || '',
      progress: fm.progress !== undefined && fm.progress !== '' ? +fm.progress : (tasks.length ? Math.round(done / tasks.length * 100) : null),
      progressBasis: fm.progress !== undefined && fm.progress !== '' ? 'set by hand' : (tasks.length ? `${done} of ${tasks.length} tasks done` : 'no tasks yet'),
      description: (sections._intro || '').trim(), tasks, links, log, updated: fm.updated || '',
    };
  }

  render(it) {
    const fm = { node: it.node || `goal:${it.slug}`, type: 'doc', title: it.title, status: it.status, owner: it.owner, effort: it.effort, cycle: it.cycle == null ? '' : it.cycle, rank: it.rank == null ? '' : it.rank, approved: it.approved ? 'true' : '', target: it.due, progress: it.progressSet == null ? '' : it.progressSet, updated: now() };
    // list items, so each is a node of its own (consecutive plain lines would be one paragraph); part-of ties it to the goal
    const prop = s => oneLine(s).replace(/[,()]/g, ' ');
    const tl = it.tasks.map(t => `- ${t.id} ${t.title} #${t.status} (${[t.owner && `owner: ${prop(t.owner)}`, t.due && `due: ${prop(t.due)}`, `part-of: ${fm.node}`].filter(Boolean).join(', ')})`);
    const body = `# ${it.title}\n\n${it.description.trim().replace(/^#{1,2} /gm, '### ')}\n\n## Links\n${it.links.map(l => `- [${l.label}](${l.url}) · ${l.source}`).join('\n')}\n\n## Tasks\n<!-- tasks -->\n${tl.join('\n')}\n<!-- /tasks -->\n\n## Log\n${[...it.log].reverse().map(l => `- ${l.ts} · ${l.source} · ${l.text}`).join('\n')}\n`;
    return joinFm(fm, body);
  }
  save(it) {
    // keep an explicit progress override only if the page already carries one
    const file = this.docFile(it.id);
    const prev = fs.existsSync(file) ? splitFm(read(file)).fm : {};
    if (it.progressSet === undefined) it.progressSet = prev.progress === undefined ? null : prev.progress;
    write(file, this.render(it));
    return this.get(it.id);
  }

  createInitiative({ project, title, description = '', owner = '', effort = '', status = 'proposed', cycle = null, due = '' }) {
    title = oneLine(title); if (!title) throw bad('title is required');
    if (!this.projects().some(p => p.slug === project)) throw notFound('project');
    if (!STATUSES.includes(status)) throw bad('unknown status');
    if (effort && !EFFORTS.includes(effort)) throw bad('effort must be S, M, L or XL');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(this.docFile(`${project}/${s}`)));
    const it = { id: `${project}/${slug}`, slug, node: `goal:${project}.${slug}`, title, status, owner: oneLine(owner), effort, cycle: cycle === '' ? null : cycle, rank: null, approved: cycle != null && cycle !== '', due, description, tasks: [], links: [], log: [{ ts: now(), source: 'tempo', text: 'Initiative created' }] };
    return this.save(it);
  }
  update(id, patch) {
    const it = this.get(id); it.progressSet = undefined;
    if (patch.title !== undefined) { it.title = oneLine(patch.title); if (!it.title) throw bad('title is required'); }
    if (patch.description !== undefined) it.description = String(patch.description);
    if (patch.owner !== undefined) it.owner = oneLine(patch.owner);
    if (patch.due !== undefined) it.due = oneLine(patch.due);
    if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) throw bad('unknown status'); if (patch.status !== it.status) it.log.unshift({ ts: now(), source: patch.source || 'tempo', text: `Status ${it.status} → ${patch.status}` }); it.status = patch.status; }
    if (patch.effort !== undefined) { if (patch.effort && !EFFORTS.includes(patch.effort)) throw bad('effort must be S, M, L or XL'); it.effort = patch.effort; }
    if (patch.cycle !== undefined) it.cycle = patch.cycle === null || patch.cycle === '' ? null : Math.round(+patch.cycle);
    if (patch.rank !== undefined) it.rank = patch.rank === null ? null : Math.round(+patch.rank);
    if (patch.approved !== undefined) it.approved = !!patch.approved;
    if (patch.progress !== undefined) it.progressSet = patch.progress === null ? '' : Math.max(0, Math.min(100, Math.round(+patch.progress)));
    if (it.cycle != null && !it.approved) it.approved = true;   // a plan holds approved items only
    return this.save(it);
  }
  remove(id) { fs.unlinkSync(this.docFile(id)); }

  // ---- tasks, links, log
  addTask(id, { title, owner = '', due = '', status = 'todo' }) {
    const it = this.get(id); title = oneLine(title); if (!title) throw bad('title is required');
    if (!TASK_STATUSES.includes(status)) throw bad('unknown task status');
    const n = it.tasks.reduce((m, t) => Math.max(m, +(/\.(\d+)$/.exec(t.id) || [0, 0])[1]), 0) + 1;
    it.tasks.push({ id: `task:${it.project}.${it.slug}.${n}`, title, status, owner: oneLine(owner), due: oneLine(due) });
    it.progressSet = undefined; return this.save(it);
  }
  updateTask(id, taskId, patch) {
    const it = this.get(id), t = it.tasks.find(x => x.id === taskId); if (!t) throw notFound('task');
    if (patch.title !== undefined) t.title = oneLine(patch.title) || t.title;
    if (patch.owner !== undefined) t.owner = oneLine(patch.owner);
    if (patch.due !== undefined) t.due = oneLine(patch.due);
    if (patch.status !== undefined) { if (!TASK_STATUSES.includes(patch.status)) throw bad('unknown task status'); t.status = patch.status; }
    it.progressSet = undefined; return this.save(it);
  }
  removeTask(id, taskId) { const it = this.get(id); it.tasks = it.tasks.filter(t => t.id !== taskId); it.progressSet = undefined; return this.save(it); }
  addLink(id, { label, url, source = 'manual' }) {
    if (!/^https?:\/\//i.test(url || '')) throw bad('url must start with http:// or https://');
    const it = this.get(id); url = url.trim();
    if (it.links.some(l => l.url === url)) return it;          // a source pushing the same link twice adds it once
    it.links.push({ label: oneLine(label).replace(/[[\]]/g, '') || url, url: url.replace(/\)/g, '%29'), source: oneLine(source) || 'manual' });
    it.progressSet = undefined; return this.save(it);
  }
  removeLink(id, url) { const it = this.get(id); it.links = it.links.filter(l => l.url !== url); it.progressSet = undefined; return this.save(it); }
  addLog(id, { text, source = 'manual' }) {
    text = oneLine(text); if (!text) throw bad('text is required');
    const it = this.get(id); it.log.unshift({ ts: now(), source: oneLine(source).replace(/\s/g, '-') || 'manual', text });
    it.progressSet = undefined; return this.save(it);
  }

  // ---- seed: a small vault to look at on a first run
  isEmpty() { return this.projects().length === 0; }
}

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
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function notFound(what) { return Object.assign(new Error(`${what} not found`), { status: 404 }); }

module.exports = { Store, STATUSES, TASK_STATUSES, EFFORTS, slugify };

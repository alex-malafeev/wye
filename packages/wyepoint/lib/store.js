'use strict';
// WyePoint's storage is a Wye vault: a product folder of Markdown (the vault is the database, no other store).
//   <vault>/_product.md                      the workspace and the cycle settings (cycle-weeks, cycle-start, cycle-cooldown)
//   <vault>/people/<name>.md                 a person the planner can name as a champion or contributor: role, team, email,
//                                            and where they came from (added by hand for now; a sync from a people
//                                            system of record would write the same pages with a source of its own)
//   <vault>/cycles/<n>.md                    what is recorded about one cycle: status, theme, dates, the snapshot taken at close
//   <vault>/projects/<p>/_project.md         a project (what the planner calls a workstream)
//   <vault>/projects/<p>/docs/<slug>.md      an initiative: a page that is a goal node, its tasks and milestones as task
//                                            lines between <!-- tasks --> markers — graph nodes `wye build` and
//                                            `wye query` read like any other page.
const fs = require('fs');
const path = require('path');
const cyclesLib = require('./cycles');
const L = require('./lines');
const T = require('./types');

const STATUSES = ['not-started', 'on-track', 'at-risk', 'off-track', 'paused', 'complete'];
const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'];
const EFFORTS = ['S', 'M', 'L', 'XL'];
const BUCKETS = ['proposed', 'next', 'later', 'icebox'];       // where an initiative waits while it has no cycle

const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled';
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const prop = s => oneLine(s).replace(/[,()]/g, ' ');           // a value inside a `(key: value, …)` group
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

// ---- the page body
// A new item goes after the last item of its kind; else at the end of the section that has its heading (Milestones,
// Updates, Links, Pull requests); else under a heading made for it at the end of the page.
function appendLine(body, line, sameKind, heading) {
  const lines = body.replace(/\s+$/, '').split('\n');
  let at = -1; if (sameKind) lines.forEach((l, i) => { const x = L.parseLine(l); if (x && sameKind(x)) at = i; });
  if (at < 0 && heading) {
    const h = lines.findIndex(l => /^#{1,3} /.test(l) && l.replace(/^#+ /, '').trim().toLowerCase() === heading.toLowerCase());
    if (h < 0) return `${lines.join('\n')}\n\n## ${heading}\n${line}`.replace(/^\n+/, '');
    let end = lines.findIndex((l, i) => i > h && /^#{1,3} /.test(l)); if (end < 0) end = lines.length;
    while (end > h + 1 && !lines[end - 1].trim()) end--;
    at = end - 1;
  }
  if (at < 0) lines.push(line); else lines.splice(at + 1, 0, line);
  return lines.join('\n');
}
const dropLines = (body, match) => body.split('\n').filter(l => { const x = L.parseLine(l); return !(x && match(x)); }).join('\n');
// The page as a person edited it, with what others added to it meanwhile: items that are in the current page but were
// neither in the page the editor opened (`base`) nor in what it sends back were added elsewhere (an API push, a webhook)
// and are kept, so a person editing never loses a link a webhook just added.
function mergeBody(incoming, current, base) {
  if (base === undefined) return incoming;
  const have = new Set(incoming.split('\n')), seen = new Set(String(base).split('\n'));
  const added = current.split('\n').filter(l => L.isItem(l) && !seen.has(l) && !have.has(l));
  const HEADING = { task: 'Milestones', log: 'Updates', link: 'Links', pr: 'Pull requests' };
  return added.reduce((body, line) => { const t = L.parseLine(line).type; return appendLine(body, line, x => x.type === t, HEADING[t]); }, incoming);
}
// text under a heading (null: the text before the first heading); the items in it stay where they are
function setSection(body, name, text) {
  const lines = body.split('\n'), head = i => /^#{2,3} /.test(lines[i]);
  let from = 0, to = lines.length;
  if (name) {
    const at = lines.findIndex((l, i) => head(i) && l.replace(/^#+ /, '').trim().toLowerCase() === name);
    if (at < 0) return `${body.replace(/\s+$/, '')}\n\n## ${name.replace(/^./, c => c.toUpperCase())}\n${text.trim()}`;
    from = at + 1;
  }
  for (let i = from; i < lines.length; i++) if (head(i)) { to = i; break; }
  const items = L.itemsOnly(lines.slice(from, to));
  lines.splice(from, to - from, ...(text.trim() ? [...text.trim().split('\n'), ''] : []), ...items, ...(to < lines.length ? [''] : []));
  return lines.join('\n');
}
// the first paragraph of the prose before the first heading, items left out
function introOf(body) { return proseSections(L.withoutItems(body.split('\n')).join('\n'))._intro.trim().split(/\n\s*\n/)[0]; }
function proseSections(prose) {
  const out = { _intro: '' }; let cur = '_intro';
  for (const line of prose.split('\n')) {
    const h = /^#{2,3} (.+?)\s*$/.exec(line);
    if (h) { cur = h[1].trim().toLowerCase(); out[cur] = out[cur] || ''; continue; }
    out[cur] += line + '\n';
  }
  return out;
}
// Pages written before the body was one document kept links, pull requests, tasks and the log under headings of their
// own. They are folded into the body, items first-class, the first time such a page is read.
function upgrade(raw) {
  if (!/^## (Tasks|Links|Pull requests|Log)\s*$/m.test(raw) || / · (link|pr) · /.test(raw)) return raw;
  const sec = sectionsOf(raw), lines = k => (sec[k] || '').split('\n').filter(l => l.startsWith('- ')), parts = [sec._intro.trim()];
  if ('What ships' in sec) parts.push(`## What ships\n${(sec['What ships'] || '').trim()}`);
  if ('Risks' in sec) parts.push(`## Risks\n${(sec.Risks || '').trim()}`);
  const refs = [];
  for (const l of lines('Links')) { const m = /^- \[(.*?)\]\((.*?)\)(?: · (.*))?$/.exec(l); if (m) refs.push(L.refLine({ type: 'link', label: m[1], url: m[2], meta: m[3] || 'manual' })); }
  for (const l of lines('Pull requests')) { const m = /^- \[(.*?)\]\((.*?)\)(?: · (.*))?$/.exec(l); if (m) refs.push(L.refLine({ type: 'pr', label: m[1], url: m[2], meta: m[3] || day() })); }
  parts.push([...lines('Tasks').filter(l => L.isItem(l)), ...refs, ...lines('Log').filter(l => L.isItem(l))].join('\n'));
  return parts.filter(Boolean).join('\n\n');
}

class Store {
  constructor(dir) { this.dir = path.resolve(dir); this.init(); }
  get productFile() { return path.join(this.dir, '_product.md'); }

  init() {
    if (fs.existsSync(this.productFile)) {
      if (this.config().title === 'Tempo') this.setConfig({ title: 'WyePoint' });   // the name before the rename
    } else write(this.productFile, joinFm({ title: 'WyePoint', icon: '🧭', description: 'Projects and initiatives planned in cycles.', 'cycle-weeks': 6, 'cycle-start': day(), 'cycle-cooldown': 7 }, ''));
    this.migrateRoster(); this.ensureTypes(); this.migrateTypes(); this.loadKinds();
  }

  // ---- config
  config() {
    const { fm } = splitFm(read(this.productFile));
    return { title: fm.title || 'WyePoint', weeks: Math.max(1, +fm['cycle-weeks'] || 6), start: fm['cycle-start'] || day(), cooldown: Math.max(0, +fm['cycle-cooldown'] || 0) };
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

  // ---- people
  peopleDir() { return path.join(this.dir, 'people'); }
  people() {
    let files = []; try { files = fs.readdirSync(this.peopleDir()).filter(f => f.endsWith('.md')); } catch { /* none yet */ }
    return files.map(f => {
      const { fm } = splitFm(read(path.join(this.peopleDir(), f)));
      return { slug: f.slice(0, -3), name: fm.title || f.slice(0, -3), role: fm.role || '', team: fm.team || '', email: fm.email || '', source: fm.source || 'manual', externalId: fm['external-id'] || '' };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  createPerson({ name, role = '', team = '', email = '', source = 'manual', externalId = '' }) {
    name = oneLine(name); if (!name) throw bad('a name is required');
    if (email && !/^\S+@\S+$/.test(oneLine(email))) throw bad('that does not look like an email address');
    if (this.people().some(p => p.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error(`${name} is already in the directory`), { status: 409 });
    const slug = this.uniqueSlug(slugify(name), s => fs.existsSync(path.join(this.peopleDir(), s + '.md')));
    write(path.join(this.peopleDir(), slug + '.md'), joinFm({ node: `person:${slug}`, title: name, role: oneLine(role), team: oneLine(team), email: oneLine(email), source: oneLine(source) || 'manual', 'external-id': oneLine(externalId) }, `# ${name}\n`));
    return this.people().find(p => p.slug === slug);
  }
  updatePerson(slug, patch) {   // the name is how initiatives refer to them, so it is not changed here
    const file = path.join(this.peopleDir(), String(slug).replace(/[^\w-]/g, '') + '.md');
    if (!fs.existsSync(file)) throw notFound('person');
    const { fm, body } = splitFm(read(file)); fm.node = fm.node || `person:${slug}`; delete fm.kind;
    for (const k of ['role', 'team']) if (patch[k] !== undefined) fm[k] = oneLine(patch[k]);
    if (patch.email !== undefined) { const e = oneLine(patch.email); if (e && !/^\S+@\S+$/.test(e)) throw bad('that does not look like an email address'); fm.email = e; }
    write(file, joinFm(fm, body));
    return this.people().find(p => p.slug === slug);
  }
  removePerson(slug) {
    const file = path.join(this.peopleDir(), String(slug).replace(/[^\w-]/g, '') + '.md');
    if (!fs.existsSync(file)) throw notFound('person');
    fs.unlinkSync(file);
  }
  // before the directory there was a roster: one name per line. Each name becomes a person, once.
  migrateRoster() {
    const file = path.join(this.dir, '_roster.md'); if (!fs.existsSync(file)) return;
    for (const n of names(read(file).split('\n'))) { try { this.createPerson({ name: n }); } catch { /* already there */ } }
    fs.unlinkSync(file);
  }

  // ---- drawings: <project>/docs/drawings/<slug>.{excalidraw,svg,png,md} — the scene, its previews and a text description
  // (the same files Wye writes), so an agent reads what a drawing says and Wye can show it
  drawingFile(project, file) {
    const m = /^([a-z0-9][a-z0-9._-]*)\.(excalidraw|svg|png|md)$/.exec(String(file || '')); if (!m) throw bad('that is not a drawing file');
    if (!this.projects().some(p => p.slug === project)) throw notFound('project');
    return { slug: m[1], ext: m[2], path: path.join(this.projectsDir(), project, 'docs', 'drawings', file) };
  }
  readDrawing(project, file) {
    const f = this.drawingFile(project, file); if (!fs.existsSync(f.path)) return null;
    return { buf: fs.readFileSync(f.path), type: { excalidraw: 'application/json', svg: 'image/svg+xml', png: 'image/png', md: 'text/markdown; charset=utf-8' }[f.ext] };
  }
  saveDrawing(project, slug, { json, svg = '', png = '', description = '' }) {
    const base = this.drawingFile(project, `${slug}.excalidraw`);
    let scene; try { scene = JSON.parse(json); } catch { throw bad('the drawing is not valid JSON'); }
    if (!scene || !Array.isArray(scene.elements)) throw bad('the drawing has no elements');
    if (/<script|javascript:|\son[a-z]+\s*=|<foreignObject/i.test(svg)) throw bad('the preview may not contain script');
    const at = ext => base.path.replace(/\.excalidraw$/, '.' + ext);
    write(base.path, String(json));
    if (svg) write(at('svg'), String(svg)); else if (fs.existsSync(at('svg'))) fs.unlinkSync(at('svg'));
    if (png) { fs.mkdirSync(path.dirname(at('png')), { recursive: true }); fs.writeFileSync(at('png') + '.tmp', Buffer.from(String(png), 'base64')); fs.renameSync(at('png') + '.tmp', at('png')); }
    write(at('md'), `# Drawing ${base.slug}\n\n${String(description).trim() || '(no text in the drawing)'}\n`);
  }

  // ---- pictures: a pasted or dropped image is a file in <project>/docs/images; the page holds `![caption](images/<file>)`
  imageFile(project, file) {
    if (!/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|gif|webp)$/i.test(String(file || ''))) throw bad('that is not a picture file');
    if (!this.projects().some(p => p.slug === project)) throw notFound('project');
    return path.join(this.projectsDir(), project, 'docs', 'images', file);
  }
  readImage(project, file) {
    const f = this.imageFile(project, file); if (!fs.existsSync(f)) return null;
    return { buf: fs.readFileSync(f), type: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[f.split('.').pop().toLowerCase()] };
  }
  saveImage(project, buf) {
    const kind = buf.length > 12 && (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
      : buf.subarray(0, 4).toString('latin1') === 'GIF8' ? 'gif' : buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : '');
    if (!kind) throw bad('that is not a PNG, JPEG, GIF or WebP picture');
    const file = `image-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${kind}`, full = this.imageFile(project, file);
    fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full + '.tmp', buf); fs.renameSync(full + '.tmp', full);
    return { url: `images/${file}` };
  }

  // ---- types: WyePoint's entities are Wye types (lib/types.js). types/ontology.md declares the app's own, types/custom.md the
  // ones a person defines; an instance of a custom type is a list line in a page (lib/lines.js).
  customFile() { return path.join(this.dir, 'types', 'custom.md'); }
  ensureTypes() {
    const f = path.join(this.dir, 'types', 'ontology.md');
    if (!read(f).includes(`wyepoint-types v${T.VERSION}:`)) write(f, T.coreDocument());
  }
  // pages written before the types: a person and a cycle become nodes of their type, a goal an initiative
  migrateTypes() {
    for (const p of this.people()) {
      const file = path.join(this.peopleDir(), p.slug + '.md'), { fm, body } = splitFm(read(file));
      if (!fm.node || fm.kind) { fm.node = fm.node || `person:${p.slug}`; delete fm.kind; write(file, joinFm(fm, body)); }
    }
    let files = []; try { files = fs.readdirSync(path.join(this.dir, 'cycles')).filter(f => /^\d+\.md$/.test(f)); } catch { /* none */ }
    for (const f of files) {
      const file = path.join(this.dir, 'cycles', f), { fm, body } = splitFm(read(file));
      if (!fm.node || fm.type) { delete fm.type; write(file, joinFm({ node: `cycle:${fm.n}`, ...fm, node: `cycle:${fm.n}` }, body)); }
    }
    for (const p of this.projects()) {
      const dir = path.join(this.projectsDir(), p.slug, 'docs'); let docs = []; try { docs = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { /* none */ }
      for (const f of docs) {
        const md = read(path.join(dir, f)), { fm } = splitFm(md);
        if (/^goal:/.test(fm.node || '') || /^\d+$/.test(fm.cycle || '')) { const it = this.parseInitiative(p.slug, f.slice(0, -3), md); if (it) this.save(it); }
      }
    }
  }
  loadKinds() { L.setKinds(this.types().map(t => t.slug)); }
  customTypes() { return T.parseCustom(read(this.customFile())).filter(t => !T.BUILTIN.some(b => b.slug === t.slug)); }   // a risk once defined in Settings is now built in
  types() { return [...T.BUILTIN, ...this.customTypes()]; }
  saveTypes(list) { write(this.customFile(), T.renderCustom(list)); this.loadKinds(); }
  createType(input) { const list = this.customTypes(), t = T.normalise(input, { taken: new Set(list.map(x => x.slug)) }); list.push(t); this.saveTypes(list); return t; }
  updateType(slug, input) {
    if (T.BUILTIN.some(b => b.slug === slug)) throw bad('a built-in type cannot be changed');
    const list = this.customTypes(), i = list.findIndex(x => x.slug === slug); if (i < 0) throw notFound('type');
    list[i] = T.normalise({ ...input, slug }); this.saveTypes(list); return list[i];
  }
  deleteType(slug) {
    if (T.BUILTIN.some(b => b.slug === slug)) throw bad('a built-in type cannot be deleted');
    const list = this.customTypes(); if (!list.some(x => x.slug === slug)) throw notFound('type');
    const used = this.typeUsage(slug);
    if (used) throw Object.assign(new Error(`${used} instance${used > 1 ? 's' : ''} of it ${used > 1 ? 'are' : 'is'} still in pages; remove ${used > 1 ? 'them' : 'it'} first`), { status: 409 });
    this.saveTypes(list.filter(x => x.slug !== slug));
  }
  typeUsage(slug) {
    const bodies = [...this.initiatives().map(i => i.body), ...this.projects().map(p => p.body)];
    return bodies.reduce((n, b) => n + b.split('\n').filter(l => { const x = L.parseLine(l); return x && x.type === 'node' && x.kind === slug; }).length, 0);
  }

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
    write(path.join(this.dir, 'cycles', `${n}.md`), joinFm({ node: `cycle:${n}`, n, title: `Cycle ${n}`, status: patch.status !== undefined ? patch.status : recs[n] && recs[n].status, theme: cur.theme, start: patch.start !== undefined ? patch.start : recs[n] && recs[n].start, end: patch.end !== undefined ? patch.end : recs[n] && recs[n].end, 'released-at': cur.releasedAt, 'closed-at': cur.closedAt }, `# Cycle ${n}\n\n## Snapshot\n${snap.join('\n')}\n`));
  }

  // ---- projects
  projectsDir() { return path.join(this.dir, 'projects'); }
  // A project is a page too: `_project.md` — its details in the front matter, then a free body (what it is, links,
  // anything else), read the way an initiative's is. Its description in the front matter follows the page, which is
  // where Wye's own views read it.
  projects() {
    let dirs = []; try { dirs = fs.readdirSync(this.projectsDir(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* none yet */ }
    return dirs.sort().map(slug => this.readProject(slug));
  }
  projectFile(slug) { return path.join(this.projectsDir(), String(slug).replace(/[^\w-]/g, ''), '_project.md'); }
  readProject(slug) {
    const { fm, body: raw } = splitFm(read(this.projectFile(slug)));
    const body = raw.replace(/^\s*# .*\n?/, '').trim() || oneLine(fm.description);
    const links = [];
    for (const line of body.split('\n')) { const x = L.parseLine(line); if (x && x.type === 'link') links.push({ label: x.label, url: x.url, source: x.meta }); }
    return { slug, title: fm.title || slug, owner: fm.owner || '', description: oneLine(introOf(body)) || oneLine(fm.description), body, links };
  }
  createProject({ title, description = '', owner = '' }) {
    title = oneLine(title); if (!title) throw bad('title is required');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(path.join(this.projectsDir(), s)));
    write(path.join(this.projectsDir(), slug, '_project.md'), joinFm({ title, kind: 'project', owner: oneLine(owner), description: oneLine(description) }, `# ${title}\n\n${String(description).trim()}\n`));
    fs.mkdirSync(path.join(this.projectsDir(), slug, 'docs'), { recursive: true });
    return this.readProject(slug);
  }
  updateProject(slug, patch) {
    const file = this.projectFile(slug);
    if (!fs.existsSync(file)) throw notFound('project');
    const { fm } = splitFm(read(file)), cur = this.readProject(slug);
    if (patch.title !== undefined) { fm.title = oneLine(patch.title); if (!fm.title) throw bad('title is required'); }
    if (patch.owner !== undefined) fm.owner = oneLine(patch.owner);
    let body = cur.body;
    if (patch.body !== undefined) body = mergeBody(String(patch.body), cur.body, patch.base);
    else if (patch.description !== undefined) body = setSection(body, null, String(patch.description));
    fm.description = oneLine(introOf(body));
    write(file, joinFm(fm, `# ${fm.title || slug}\n\n${body.trim()}\n`));
    return this.readProject(slug);
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

  // The page is one free-form document; its items (lib/lines.js) are lines of it wherever the person put them, and
  // everything else is prose. The description is the prose before the first heading; "What ships" and "Risks" are
  // headings the planner looks for by name.
  parseInitiative(project, slug, md) {
    const { fm, body: raw } = splitFm(md);
    if (!/^(goal|initiative):/.test(fm.node || '')) return null;   // a page that is not an initiative
    const node = fm.node.replace(/^goal:/, 'initiative:');
    const body = upgrade(raw.replace(/^\s*# .*\n?/, '')).split(fm.node).join(node).trim();   // a goal's milestones are part of the initiative now
    const tasks = [], links = [], prs = [], log = [], nodes = [], drawings = [], prose = [];
    const all = body.split('\n'), noteAt = L.noteMask(all);
    for (const [at, line] of all.entries()) {
      if (noteAt[at]) { nodes[nodes.length - 1].notes = (nodes[nodes.length - 1].notes ? nodes[nodes.length - 1].notes + '\n' : '') + line.slice(2); continue; }
      const x = L.parseLine(line);
      if (!x) prose.push(line);
      else if (x.type === 'task') tasks.push({ id: x.id, title: x.title, status: x.status, owner: x.owner, due: x.due });
      else if (x.type === 'link') links.push({ label: x.label, url: x.url, source: x.meta });
      else if (x.type === 'pr') prs.push({ title: x.label, url: x.url, ts: x.meta });
      else if (x.type === 'node') nodes.push({ id: x.id, kind: x.kind, text: x.text, status: x.status, props: x.props, notes: '' });
      else if (x.type === 'drawing') drawings.push({ title: x.title, src: x.src });
      else log.push({ ts: x.ts, source: x.source, text: x.text });
    }
    log.reverse();                                            // newest first; the page reads oldest first, like any log
    const ps = proseSections(prose.join('\n')), pick = re => (Object.entries(ps).find(([k]) => re.test(k)) || [, ''])[1].trim();
    const num = v => (v === undefined || v === '' ? null : +v);
    return {
      id: `${project}/${slug}`, project, slug, node, title: fm.title || slug, status: fm.status || '', owner: fm.owner || '',
      contributors: names(fm.contributors), mission: fm.mission || '', effort: fm.effort || '', cycle: num(String(fm.cycle || '').replace(/^cycle:/, '')), rank: num(fm.rank),
      approved: fm.approved === 'true', bucket: fm.bucket || 'proposed', target: fm.target || '',
      body, description: ps._intro.trim(), ships: pick(/^what ships$/), risks: [pick(/^(dependencies\s*\/\s*)?risks?$|^dependencies/), ...nodes.filter(n => n.kind === 'risk' && !/^(closed|mitigated)$/.test(n.status)).map(n => n.text)].filter(Boolean).join('; '),
      tasks, links, prs, log, nodes, drawings, updated: fm.updated || '',
    };
  }

  render(it) {
    // the people are edges to person nodes where they are in the directory; the names stay as the text people read
    const dir = this.people(), ref = n => { const p = dir.find(x => x.name.toLowerCase() === String(n || '').toLowerCase()); return p ? `person:${p.slug}` : ''; };
    const involved = [...new Set([it.owner, ...it.contributors].map(ref).filter(Boolean))];
    const fm = { node: it.node, title: it.title, status: it.status, owner: it.owner, champion: ref(it.owner), involves: involved.join(', '), contributors: it.contributors.join(', '), mission: it.mission, effort: it.effort, cycle: it.cycle == null ? '' : `cycle:${it.cycle}`, rank: it.rank == null ? '' : it.rank, approved: it.approved ? 'true' : '', bucket: it.cycle == null && it.bucket !== 'proposed' ? it.bucket : '', target: it.target, updated: now() };
    return joinFm(fm, `# ${it.title}\n\n${it.body.trim()}\n`);
  }
  save(it) {
    // an initiative points at its cycle: a cycle that has no page yet gets one, so the edge has somewhere to go
    if (it.cycle != null && !fs.existsSync(path.join(this.dir, 'cycles', `${it.cycle}.md`))) this.saveCycle(it.cycle, {});
    write(this.docFile(it.id), this.render(it)); return this.get(it.id);
  }

  createInitiative(o) {
    const { project } = o, title = oneLine(o.title); if (!title) throw bad('title is required');
    if (!this.projects().some(p => p.slug === project)) throw notFound('project');
    const slug = this.uniqueSlug(slugify(title), s => fs.existsSync(this.docFile(`${project}/${s}`)));
    const node = `initiative:${project}.${slug}`;
    // a page from the dialog may hold milestones and typed blocks numbered before the page had an id (task:new.1, risk:new.1, part-of initiative:TBD)
    const body = (o.body !== undefined ? String(o.body) : `${String(o.description || '').trim()}\n\n## What ships\n${String(o.ships || '').trim()}\n${String(o.risks || '').trim() ? `\n## Risks\n${String(o.risks).trim()}\n` : ''}\n## Milestones\n\n## Updates\n`)
      .replace(/\b([a-z][a-z0-9-]*):new\.(\d+)/g, `$1:${project}.${slug}.$2`).replace(/\b(goal|initiative):TBD/g, node);
    const it = { id: `${project}/${slug}`, slug, project, node, title, status: '', owner: '', contributors: [], mission: '', effort: '', cycle: null, rank: null, approved: false, bucket: 'proposed', target: '', body };
    this.apply(it, { ...o, body: undefined, description: undefined, ships: undefined, risks: undefined });
    it.body = appendLine(it.body, L.logLine({ ts: now(), source: 'wyepoint', text: 'Initiative created' }), x => x.type === 'log', 'Updates');   // no status-change line for the status it starts with
    return this.save(it);
  }
  apply(it, patch) {
    if (patch.title !== undefined) { it.title = oneLine(patch.title); if (!it.title) throw bad('title is required'); }
    if (patch.body !== undefined) it.body = mergeBody(String(patch.body), it.body, patch.base);
    else for (const [k, name] of [['description', null], ['ships', 'what ships'], ['risks', 'risks']]) if (patch[k] !== undefined) it.body = setSection(it.body, name, String(patch[k]));
    if (patch.owner !== undefined) it.owner = oneLine(patch.owner);
    if (patch.contributors !== undefined) it.contributors = names(patch.contributors);
    if (patch.mission !== undefined) it.mission = oneLine(patch.mission);
    if (patch.target !== undefined) { const t = oneLine(patch.target); if (t && !isDate(t)) throw bad('target must be YYYY-MM-DD'); it.target = t; }
    if (patch.status !== undefined) {
      if (patch.status && !STATUSES.includes(patch.status)) throw bad('unknown status');
      // a new page has no status-change line for the status it starts with
      if (patch.status !== it.status && / · (wyepoint|tempo) · Initiative created/.test(it.body)) it.body = appendLine(it.body, L.logLine({ ts: now(), source: patch.source || 'wyepoint', text: `Status ${it.status || 'none'} → ${patch.status || 'none'}` }), x => x.type === 'log', 'Updates');
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

  // ---- items: lines of the page body
  edit(id, fn) { const it = this.get(id); it.body = fn(it.body, it); return this.save(it); }
  addTask(id, { title, owner = '', due = '', status = 'todo' }) {
    title = oneLine(title); if (!title) throw bad('title is required');
    if (!TASK_STATUSES.includes(status)) throw bad('unknown task status');
    if (due && !isDate(oneLine(due))) throw bad('due must be YYYY-MM-DD');
    return this.edit(id, (body, it) => {
      const n = it.tasks.reduce((m, t) => Math.max(m, +(/\.(\d+)$/.exec(t.id) || [0, 0])[1]), 0) + 1;
      return appendLine(body, L.taskLine({ id: `task:${it.project}.${it.slug}.${n}`, title, status, owner: oneLine(owner), due: oneLine(due) }, it.node), x => x.type === 'task', 'Milestones');
    });
  }
  updateTask(id, taskId, patch) {
    const it = this.get(id), t = it.tasks.find(x => x.id === taskId); if (!t) throw notFound('task');
    if (patch.title !== undefined) t.title = oneLine(patch.title) || t.title;
    if (patch.owner !== undefined) t.owner = oneLine(patch.owner);
    if (patch.due !== undefined) { if (patch.due && !isDate(oneLine(patch.due))) throw bad('due must be YYYY-MM-DD'); t.due = oneLine(patch.due); }
    if (patch.status !== undefined) { if (!TASK_STATUSES.includes(patch.status)) throw bad('unknown task status'); t.status = patch.status; }
    it.body = it.body.split('\n').map(l => { const x = L.parseLine(l); return x && x.type === 'task' && x.id === taskId ? L.taskLine(t, it.node) : l; }).join('\n');
    return this.save(it);
  }
  removeTask(id, taskId) { return this.edit(id, body => dropLines(body, x => x.type === 'task' && x.id === taskId)); }
  addLink(id, { label, url, source = 'manual' }) {
    if (!/^https?:\/\//i.test(url || '')) throw bad('url must start with http:// or https://');
    const it = this.get(id); url = url.trim();
    if (it.links.some(l => l.url === url.replace(/\)/g, '%29'))) return it;      // a source pushing the same link twice adds it once
    return this.edit(id, body => appendLine(body, L.refLine({ type: 'link', label, url, meta: source }), x => x.type === 'link', 'Links'));
  }
  removeLink(id, url) { return this.edit(id, body => dropLines(body, x => x.type === 'link' && x.url === url)); }
  addPr(id, { title, url }) {
    if (!/^https?:\/\//i.test(url || '')) throw bad('url must start with http:// or https://');
    const it = this.get(id); url = url.trim();
    if (it.prs.some(p => p.url === url.replace(/\)/g, '%29'))) return it;
    return this.edit(id, body => appendLine(body, L.refLine({ type: 'pr', label: title, url, meta: day() }), x => x.type === 'pr', 'Pull requests'));
  }
  removePr(id, url) { return this.edit(id, body => dropLines(body, x => x.type === 'pr' && x.url === url)); }
  addLog(id, { text, source = 'manual' }) {
    text = oneLine(text); if (!text) throw bad('text is required');
    return this.edit(id, body => appendLine(body, L.logLine({ ts: now(), source, text }), x => x.type === 'log', 'Updates'));
  }

  isEmpty() { return this.projects().length === 0; }
}

module.exports = { Store, STATUSES, TASK_STATUSES, EFFORTS, BUCKETS, slugify, oneLine };

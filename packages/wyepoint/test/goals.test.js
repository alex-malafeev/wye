'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wp-goals-'));

test('a goal is a page: a goal node with a key, an owner, a target and a Slack channel', () => {
  const dir = tmp(), s = new Store(dir);
  const g = s.createGoal({ title: 'Grow self-serve', owner: 'Dana', target: '2027-01-31', description: 'More accounts activate alone.' });
  assert.deepStrictEqual([g.slug, g.key, g.status, g.owner, g.target, g.description], ['grow-self-serve', 'GOAL-1', 'on-track', 'Dana', '2027-01-31', 'More accounts activate alone.']);
  const md = fs.readFileSync(path.join(dir, 'goals/grow-self-serve.md'), 'utf8');
  assert.match(md, /^---\nnode: goal:grow-self-serve\nkey: GOAL-1\n/);
  assert.strictEqual(s.updateGoal(g.slug, { slack: 'https://acme.slack.com/archives/C1', status: 'at-risk' }).slack, 'https://acme.slack.com/archives/C1');
  assert.throws(() => s.updateGoal(g.slug, { status: 'wat' }), /unknown status/);
  assert.throws(() => s.updateGoal(g.slug, { target: 'soon' }), /YYYY-MM-DD/);
  assert.throws(() => s.updateGoal(g.slug, { slack: 'nope' }), /link/);
  assert.throws(() => s.updateGoal('nope', {}), /goal not found/);
  assert.strictEqual(s.createGoal({ title: 'Another' }).key, 'GOAL-2');
});

test('a project points at its goal; a goal with projects under it cannot be deleted', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const g = s.createGoal({ title: 'Reliability' });
  const it = s.createInitiative({ project: 'p', title: 'Thing', goal: g.slug });
  assert.deepStrictEqual([it.goal, it.mission], ['reliability', 'Reliability']);
  assert.throws(() => s.update(it.id, { goal: 'nope' }), /goal not found/);
  assert.throws(() => s.deleteGoal(g.slug), /1 project is still under/);
  s.update(it.id, { goal: '' }); s.deleteGoal(g.slug);
  assert.deepStrictEqual(s.goals(), []);
});

test('the older free-text mission is a goal now: by name, one for each distinct name', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const a = s.createInitiative({ project: 'p', title: 'A', mission: 'Growth' }), b = s.createInitiative({ project: 'p', title: 'B', mission: 'growth' });
  assert.deepStrictEqual([a.goal, b.goal, s.goals().length], ['growth', 'growth', 1]);
});

test('a vault whose pages carry a mission is migrated to goals once', () => {
  const dir = tmp(), s = new Store(dir); s.createProject({ title: 'P' });
  const a = s.createInitiative({ project: 'p', title: 'A' });
  const file = path.join(dir, 'areas/p/docs/a.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ntitle: A\n', '\ntitle: A\nmission: Platform health\n'));
  const again = new Store(dir).get(a.id);
  assert.deepStrictEqual([again.goal, again.mission], ['platform-health', 'Platform health']);
  assert.ok(!/mission:/.test(fs.readFileSync(file, 'utf8')));
  assert.match(fs.readFileSync(file, 'utf8'), /\ngoal: goal:platform-health\n/);
});

test('cycles ahead are defined in the settings: how many, and each one its theme and dates; a project is put in one', () => {
  const analysis = require('../lib/analysis');
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  assert.strictEqual(s.config().horizon, 2);
  const before = analysis.analyze(s).cycles.length;
  assert.strictEqual(s.setConfig({ horizon: 6 }).horizon, 6);
  assert.strictEqual(analysis.analyze(s).cycles.length, 7);   // cycle 0, and six ahead
  assert.ok(analysis.analyze(s).cycles.length > before);
  assert.throws(() => s.setConfig({ horizon: 1 }), /2–12/);
  s.saveCycle(3, { theme: 'Quality', start: '2027-02-01', end: '2027-03-12' }); const c = s.cycle(3);
  assert.deepStrictEqual([c.theme, c.start, c.end], ['Quality', '2027-02-01', '2027-03-12']);
  const it = s.createInitiative({ project: 'p', title: 'A' });
  const moved = s.update(it.id, { cycle: 3, approved: true });
  assert.strictEqual(moved.cycle, 3);
  assert.strictEqual(s.update(it.id, { cycle: null, rank: null }).cycle, null);
});

test('a person is linked to what they own and are responsible for, and to the history they took part in', () => {
  const analysis = require('../lib/analysis');
  const s = new Store(tmp()); s.createProject({ title: 'P' }); s.createPerson({ name: 'Lee', role: 'Engineer' });
  s.createGoal({ title: 'Reliability', owner: 'Lee' });
  const it = s.createInitiative({ project: 'p', title: 'Billing', owner: 'Dana', goal: 'reliability', body: '- task:new.1 Invoice list #in-progress (owner: Lee)\n- risk:new.1 Sandbox flaky #open (severity: high, responsible: person:lee)\n' });
  s.addLog(it.id, { text: 'Lee confirmed the provider fix', source: 'slack' });
  const lee = analysis.analyze(s).people.find(p => p.n === 'Lee').links;
  assert.deepStrictEqual(lee.milestones.map(m => [m.key, m.title, m.projectTitle]), [['TASK-1', 'Invoice list', 'Billing']]);
  assert.deepStrictEqual(lee.risks.map(r => [r.key, r.title, r.severity]), [['RISK-1', 'Sandbox flaky', 'high']]);
  assert.deepStrictEqual(lee.goals.map(g => g.key), ['GOAL-1']);
  assert.deepStrictEqual(lee.history.map(h => [h.kind, h.source]), [['update', 'slack']]);
  assert.deepStrictEqual(analysis.analyze(s).people.find(p => p.n === 'Dana').links.milestones, []);
});

test('the library holds documents: a doc node with a key, a category, an owner and links to goals and projects', () => {
  const dir = tmp(), s = new Store(dir); s.createProject({ title: 'P' });
  const g = s.createGoal({ title: 'Growth' }), it = s.createInitiative({ project: 'p', title: 'Onboarding' });
  const d = s.createDoc({ title: 'Acme Freight', category: 'Customer', owner: 'Dana', body: 'A carrier.\n\n## Notes\nCalls on Thursday.' });
  assert.deepStrictEqual([d.slug, d.key, d.category, d.owner, d.description], ['acme-freight', 'DOC-1', 'Customer', 'Dana', 'A carrier.']);
  assert.match(fs.readFileSync(path.join(dir, 'library/acme-freight.md'), 'utf8'), /^---\nnode: doc:acme-freight\nkey: DOC-1\n/);
  const rel = s.updateDoc(d.slug, { related: [`goal:${g.slug}`, `project:${it.id.replace('/', '.')}`, `goal:${g.slug}`] });
  assert.deepStrictEqual(rel.related, ['goal:growth', 'project:p.onboarding']);
  assert.match(fs.readFileSync(path.join(dir, 'library/acme-freight.md'), 'utf8'), /\nrelated-to: goal:growth, project:p\.onboarding\n/);
  assert.throws(() => s.updateDoc(d.slug, { related: ['goal:nope'] }), /not a goal or project/);
  assert.throws(() => s.updateDoc('nope', {}), /document not found/);
  assert.throws(() => s.createDoc({ title: ' ' }), /title is required/);
  assert.strictEqual(s.createDoc({ title: 'Second' }).key, 'DOC-2');
  assert.strictEqual(s.updateDoc(d.slug, { body: 'Changed.' }).description, 'Changed.');
  s.deleteDoc(d.slug); assert.deepStrictEqual(s.docs().map(x => x.slug), ['second']);
});

test('a picture pasted into a library document is kept with the library', () => {
  const dir = tmp(), s = new Store(dir);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADq0s0eKvAAAAAElFTkSuQmCC', 'base64');
  const { url } = s.saveImage('_library', png);
  assert.ok(fs.existsSync(path.join(dir, 'library/images', url.slice(7))));
  assert.deepStrictEqual(s.readImage('_library', url.slice(7)).type, 'image/png');
});

test('library folders are real folders: nested, kept when empty, renamed and removed, and a document moves between them', () => {
  const dir = tmp(), s = new Store(dir);
  assert.strictEqual(s.createFolder('Customers'), 'Customers'); s.createFolder('Customers/Acme');
  assert.deepStrictEqual(s.libraryFolders(), ['Customers', 'Customers/Acme']);
  assert.throws(() => s.createFolder('Customers'), /already exists/);
  assert.throws(() => s.createFolder('images'), /pictures/);
  assert.throws(() => s.createFolder('.hidden'), /cannot be a folder name/);
  const d = s.createDoc({ title: 'Call notes', folder: 'Customers/Acme', body: '## Notes\nThey want it by March.\n\n- first' });
  assert.ok(fs.existsSync(path.join(dir, 'library/Customers/Acme/call-notes.md')));
  assert.deepStrictEqual([d.folder, d.description], ['Customers/Acme', 'They want it by March.']);   // the preview skips headings
  assert.throws(() => s.createDoc({ title: 'X', folder: 'Nope' }), /folder not found/);
  assert.throws(() => s.deleteFolder('Customers/Acme'), /not empty/);
  assert.strictEqual(s.renameFolder('Customers/Acme', 'Acme Freight'), 'Customers/Acme Freight');
  assert.strictEqual(s.readDoc('call-notes').folder, 'Customers/Acme Freight');                  // the document moved with it, and kept its slug and key
  assert.strictEqual(s.readDoc('call-notes').key, 'DOC-1');
  const moved = s.updateDoc('call-notes', { folder: '' });
  assert.ok(moved.folder === '' && fs.existsSync(path.join(dir, 'library/call-notes.md')) && !fs.existsSync(path.join(dir, 'library/Customers/Acme Freight/call-notes.md')));
  s.deleteFolder('Customers/Acme Freight'); assert.deepStrictEqual(s.libraryFolders(), ['Customers']);
  assert.strictEqual(s.docs().length, 1);
  assert.strictEqual(s.createDoc({ title: 'Call notes' }).slug, 'call-notes-2');                    // a slug is unique across folders
});

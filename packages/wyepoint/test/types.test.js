'use strict';
// WyePoint's entities are Wye types: declared in the vault, with real edges, and a person can define more.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Store } = require('../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-types-'));
const WYE = path.join(__dirname, '..', '..', '..', 'bin', 'wye.js');
const wye = (...args) => spawnSync(process.execPath, [WYE, ...args], { encoding: 'utf8', cwd: path.join(__dirname, '..', '..', '..') });   // from the repo root, as Wye is run

test('the core types are declared in the vault and pages are nodes of them', () => {
  const dir = tmp(), s = new Store(dir);
  const onto = fs.readFileSync(path.join(dir, 'types/ontology.md'), 'utf8');
  for (const t of ['person', 'cycle', 'initiative']) assert.match(onto, new RegExp(`- id: type:${t}\\n`));
  assert.match(onto, /extends: type:goal/);
  s.createProject({ title: 'P' }); s.createPerson({ name: 'Lee', role: 'Eng' }); s.createPerson({ name: 'Dana' });
  const it = s.createInitiative({ project: 'p', title: 'Thing', owner: 'Lee', contributors: 'Dana, Outsider', cycle: 1, approved: true });
  const md = fs.readFileSync(path.join(dir, 'projects/p/docs/thing.md'), 'utf8');
  assert.match(md, /node: initiative:p\.thing\n/); assert.match(md, /champion: person:lee\n/);
  assert.match(md, /involves: person:lee, person:dana\n/);                    // the one who is not in the directory has no edge, only a name
  assert.match(md, /contributors: Dana, Outsider\n/); assert.match(md, /cycle: cycle:1\n/);
  assert.deepStrictEqual([it.cycle, it.owner, it.contributors], [1, 'Lee', ['Dana', 'Outsider']]);
  assert.match(fs.readFileSync(path.join(dir, 'people/lee.md'), 'utf8'), /^---\nnode: person:lee\n/);
  s.saveCycle(1, { theme: 'x' }); assert.match(fs.readFileSync(path.join(dir, 'cycles/1.md'), 'utf8'), /^---\nnode: cycle:1\n/);
});

test('pages written before the types are migrated: goal → initiative, person and cycle nodes', () => {
  const dir = tmp(); new Store(dir);
  fs.mkdirSync(path.join(dir, 'projects/p/docs'), { recursive: true }); fs.mkdirSync(path.join(dir, 'people'), { recursive: true }); fs.mkdirSync(path.join(dir, 'cycles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects/p/_project.md'), '---\ntitle: P\n---\n');
  fs.writeFileSync(path.join(dir, 'projects/p/docs/old.md'), '---\nnode: goal:p.old\ntype: doc\ntitle: Old\nowner: Lee\ncycle: 2\n---\n# Old\n\n- task:p.old.1 One #todo (part-of: goal:p.old)\n');
  fs.writeFileSync(path.join(dir, 'people/lee.md'), '---\ntitle: Lee\nkind: person\nsource: manual\n---\n# Lee\n');
  fs.writeFileSync(path.join(dir, 'cycles/2.md'), '---\nn: 2\ntype: doc\ntitle: Cycle 2\nstatus: planned\n---\n# Cycle 2\n');
  const s = new Store(dir);
  const md = fs.readFileSync(path.join(dir, 'projects/p/docs/old.md'), 'utf8');
  assert.match(md, /node: initiative:p\.old\n/); assert.match(md, /cycle: cycle:2\n/); assert.match(md, /part-of: initiative:p\.old/); assert.ok(!/goal:/.test(md));
  assert.match(fs.readFileSync(path.join(dir, 'people/lee.md'), 'utf8'), /node: person:lee/); assert.ok(!/kind:/.test(fs.readFileSync(path.join(dir, 'people/lee.md'), 'utf8')));
  assert.match(fs.readFileSync(path.join(dir, 'cycles/2.md'), 'utf8'), /node: cycle:2/);
  assert.strictEqual(s.get('p/old').cycle, 2);
});

test('a custom type: validated, written as a Wye card, instances are items of a page', () => {
  const dir = tmp(), s = new Store(dir); s.createProject({ title: 'P' });
  const t = s.createType({ name: 'Risk', plural: 'Risks', purpose: 'Something that could go wrong', statuses: 'open, mitigated, closed', fields: [{ name: 'severity', kind: 'choice', options: 'low, medium, high' }, { name: 'detail', kind: 'longtext' }, { name: 'responsible', kind: 'person' }, { name: 'due', kind: 'date' }.constructor === Object ? { name: 'review-by', kind: 'date' } : null].filter(Boolean) });
  assert.deepStrictEqual([t.slug, t.statuses, t.fields.map(f => f.name)], ['risk', ['open', 'mitigated', 'closed'], ['severity', 'detail', 'responsible', 'review-by']]);
  const card = fs.readFileSync(path.join(dir, 'types/custom.md'), 'utf8');
  assert.match(card, /- id: type:risk\n {2}extends: type:node/); assert.match(card, /severity: enum \[low, medium, high\]\?/); assert.match(card, /responsible: ref person\?/);
  assert.deepStrictEqual(new Store(dir).types(), s.types());                    // read back exactly as written
  const it = s.createInitiative({ project: 'p', title: 'Thing', body: 'Intro\n\n- risk:new.1 Sandbox is flaky #open (severity: high)\n' });
  assert.deepStrictEqual(it.nodes.map(n => [n.id, n.kind, n.text, n.status, n.props.severity]), [['risk:p.thing.1', 'risk', 'Sandbox is flaky', 'open', 'high']]);
  assert.strictEqual(it.description, 'Intro');                                  // the instance is an item, not prose
  assert.strictEqual(s.typeUsage('risk'), 1);
  assert.throws(() => s.deleteType('risk'), /still in pages/);
  s.update(it.id, { body: 'Intro' }); s.deleteType('risk'); assert.deepStrictEqual(s.types(), []);
});

test('a custom type cannot take a name Wye or WyePoint uses, nor a field name every node has', () => {
  const s = new Store(tmp());
  for (const name of ['Goal', 'Task', 'Person', 'Decision']) assert.throws(() => s.createType({ name }), /already a type/);   // decision is a Wye type
  assert.throws(() => s.createType({ name: '  ' }), /needs a name/);
  assert.throws(() => s.createType({ name: 'Risk', fields: [{ name: 'owner', kind: 'text' }] }), /a name Wye uses/);
  assert.throws(() => s.createType({ name: 'Risk', fields: [{ name: 'a', kind: 'text' }, { name: 'a', kind: 'text' }] }), /twice/);
  assert.throws(() => s.createType({ name: 'Risk', fields: [{ name: 'size', kind: 'choice' }] }), /at least one option/);
  assert.throws(() => s.createType({ name: 'Risk', fields: [{ name: 'size', kind: 'nope' }] }), /not a kind of field/);
  s.createType({ name: 'Risk' }); assert.throws(() => s.createType({ name: 'risk' }), /already a type called/);
  assert.deepStrictEqual(s.updateType('risk', { name: 'Risk', fields: [{ name: 'impact', kind: 'number' }] }).fields, [{ name: 'impact', kind: 'number' }]);
});

test('Wye itself reads it: wye check is clean and the graph has the edges and the instances', { skip: !fs.existsSync(WYE) }, () => {
  const dir = tmp(), s = new Store(dir); require('../lib/seed')(s);
  assert.deepStrictEqual(s.types().map(t => t.slug), ['risk']);                  // the sample vault defines one, and uses it on the billing page
  const built = wye('build', '--root', dir); assert.strictEqual(built.status, 0, built.stderr + built.stdout);
  assert.match(built.stdout, /initiative \d+/); assert.match(built.stdout, /person 6/); assert.match(built.stdout, /risk 1/); assert.match(built.stdout, /cycle \d/);
  const check = wye('check', '--root', dir); assert.match(check.stdout, /0 error\(s\), 0 warning\(s\)/, check.stdout);
  const node = wye('graph', 'get', 'initiative:customer-platform.billing-page-rewrite', '--root', dir).stdout;
  assert.match(node, /champion → person:lee/); assert.match(node, /involves → person:/); assert.match(node, /cycle → cycle:0/);
  const lee = wye('graph', 'get', 'person:lee', '--root', dir).stdout;                       // the inverses the types declare
  assert.match(lee, /champions → initiative:customer-platform\.billing-page-rewrite/); assert.match(lee, /involved-in → initiative:/); assert.match(lee, /responsible by risk:customer-platform\.billing-page-rewrite\.1/);
  assert.match(wye('graph', 'get', 'cycle:0', '--root', dir).stdout, /initiatives → initiative:/);
  assert.match(wye('graph', 'get', 'risk:customer-platform.billing-page-rewrite.1', '--root', dir).stdout, /Payments sandbox is flaky/);
});

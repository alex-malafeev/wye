'use strict';
// What Wye ships reaches a product from the install (lib/shipped, req:waterfall.global-skills.from-install): a
// product with no copies gets every base skill, workflow and shipped hook in its graph, under its Skills / Hooks page;
// its own document or card of the same id replaces the shipped one; nothing is written outside _build.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { buildGraph } = require('../lib/build');
const { Graph } = require('../lib/graph');
const { BASE_SKILLS } = require('../lib/shipped');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-shipped-')));
const sys = path.join(root, 'projects/app/.wye'); fs.mkdirSync(sys, { recursive: true });
const page = (node, title) => `---\nnode: ${node}\ntype: module\ntitle: ${title}\nstatus: active\nowner: unassigned\nlast-verified: 2026-10-12\n---\n\n# ${title}\n`;
fs.writeFileSync(path.join(root, '_product.md'), '---\nslug: app\ntitle: App\n---\n');
fs.writeFileSync(path.join(root, 'projects/app/_project.md'), '---\nslug: app\ntitle: App\n---\n');
fs.writeFileSync(path.join(sys, 'skills.md'), page('module:app-skills', 'Skills'));
fs.writeFileSync(path.join(sys, 'hooks.md'), page('module:app-hooks', 'Hooks'));
const before = fs.readdirSync(sys).sort();

let { graph } = buildGraph(root, { cwd: root });
const ids = graph.nodes.filter(n => n.defined).map(n => n.id);
for (const s of BASE_SKILLS) assert(ids.includes(`skill:${s.slug}`), `skill:${s.slug} comes from the install`);
for (const id of ['workflow:feature', 'hook:import-analyse', 'template:test-card']) assert(ids.includes(id), `${id} comes from the install`);
assert(graph.edges.some(e => e.from === 'skill:remember' && e.verb === 'part-of' && e.to === 'module:app-skills'), 'a shipped skill sits under the Skills page');
assert(graph.edges.some(e => e.from === 'module:shipped-hooks' && e.verb === 'part-of' && e.to === 'module:app-hooks'), 'the shipped hooks sit under the Hooks page');
assert.deepStrictEqual(fs.readdirSync(sys).sort(), before, 'nothing is written into the product');
assert.deepStrictEqual(new Graph(graph).check({ repo: root }).errors, [], 'the product checks clean');

// the product's own skill and hook replace the shipped ones
fs.writeFileSync(path.join(sys, 'skill-remember.md'), '---\nnode: skill:remember\ntype: skill\ntitle: Remember, our way\nstatus: active\nowner: unassigned\nlast-verified: 2026-10-12\nrole: librarian\npart-of: module:app-skills\n---\n\n# Remember, our way\n\nOnly ever file facts.\n');
fs.appendFileSync(path.join(sys, 'hooks.md'), '\n```yaml\n- id: hook:import-analyse\n  title: Imports wait for a person\n  on: module.created\n  do: notify "Imported {{title}}"\n  status: paused\n```\n');
({ graph } = buildGraph(root, { cwd: root }));
const one = id => graph.nodes.filter(n => n.id === id && n.defined);
assert.strictEqual(one('skill:remember').length, 1); assert.strictEqual(one('skill:remember')[0].title, 'Remember, our way', 'the own skill wins');
assert.strictEqual(one('hook:import-analyse').length, 1); assert(/Imports wait/.test(one('hook:import-analyse')[0].title), 'the own hook wins');
assert(!fs.existsSync(path.join(root, '_build/shipped/app/skill-remember.md')), 'the replaced skill is not rendered');
assert.deepStrictEqual(new Graph(graph).check({ repo: root }).errors, [], 'still clean with overrides');
console.log('shipped ok — skills, workflows and hooks from the install, the product\'s own replace them, nothing written into it');

// an own copy follows the install while its text is untouched; an edited one stays and says it is behind
{
  const { copyState, writeShipped } = require('../lib/shipped');
  const inst = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-install-')));
  fs.mkdirSync(path.join(inst, 'prompts')); fs.writeFileSync(path.join(inst, 'prompts/remember.md'), '# Remember\n\nVersion one.\n');
  const prod = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-follow-')));
  const w = path.join(prod, 'projects/app/.wye'); fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, 'skills.md'), '---\nnode: module:app-skills\ntype: module\ntitle: Skills\n---\n');
  const [shipped] = writeShipped(prod, [], inst).filter(f => f.endsWith('skill-remember.md'));
  const copy = path.join(w, 'skill-remember.md');
  fs.writeFileSync(copy, fs.readFileSync(shipped, 'utf8').replace('status: active', 'status: paused'));   // only the status changed
  fs.writeFileSync(path.join(inst, 'prompts/remember.md'), '# Remember\n\nVersion two.\n');
  assert.deepStrictEqual((({ edited, behind }) => ({ edited, behind }))(copyState(prod, fs.readFileSync(copy, 'utf8'), inst)), { edited: false, behind: true });
  writeShipped(prod, [copy], inst);
  const followed = fs.readFileSync(copy, 'utf8');
  assert(followed.includes('Version two.') && followed.includes('status: paused'), 'an untouched copy takes the new text and keeps its status');
  fs.writeFileSync(copy, followed.replace('Version two.', 'Our own words.'));
  fs.writeFileSync(path.join(inst, 'prompts/remember.md'), '# Remember\n\nVersion three.\n');
  writeShipped(prod, [copy], inst);
  assert(fs.readFileSync(copy, 'utf8').includes('Our own words.'), 'an edited copy is never overwritten');
  const st = copyState(prod, fs.readFileSync(copy, 'utf8'), inst);
  assert(st.edited && st.behind && st.shippedText === 'Version three.', 'it says the shipped one moved on, with its text');
  console.log('shipped ok — an untouched copy follows the install, an edited one stays and says it is behind');
}

// a product made before: its untouched copies and unedited shipped or retired hook cards go; changed ones stay
{
  const { migrateCopies, shippedDocs } = require('../lib/shipped');
  const prod = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-migrate-')));
  const w = path.join(prod, 'projects/app/.wye'); fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, 'skills.md'), '---\nnode: module:app-skills\ntype: module\ntitle: Skills\n---\n');
  const docs = shippedDocs(prod, []);
  const doc = n => docs.find(d => d.name === n).text;
  fs.writeFileSync(path.join(w, 'skill-remember.md'), doc('skill-remember.md'));                                   // untouched
  fs.writeFileSync(path.join(w, 'skill-build.md'), doc('skill-build.md').replace('status: active', 'status: paused')); // status changed
  fs.writeFileSync(path.join(w, 'skill-plan.md'), doc('skill-plan.md').trimEnd() + '\n\nOur extra step.\n');          // text changed
  fs.writeFileSync(path.join(w, 'workflow-feature.md'), doc('workflow-feature.md'));
  const shippedCard = doc('shipped-hooks.md').match(/^- id: hook:import-analyse\n(?:  .*\n)*/m)[0];
  const retired = '- id: hook:req-approved-tests\n  title: An approved requirement gets a task to define its test cases, and an agent starts on it\n  on: req.status:approved\n  do: task "Define test cases for {{title}}" --worker agent --skill skill:define-tests\n  once: true\n  status: active\n';
  const mine = '- id: hook:ours\n  title: Ours\n  on: req.created\n  do: notify "x"\n';
  fs.writeFileSync(path.join(w, 'hooks.md'), '---\nnode: module:app-hooks\ntype: module\ntitle: Hooks\n---\n\n```yaml\n' + shippedCard + retired.replace('status: active', 'status: paused') + mine + '```\n');
  const gone = migrateCopies(prod).map(f => path.basename(f)).sort();
  assert.deepStrictEqual(gone, ['hooks.md', 'skill-remember.md', 'workflow-feature.md']);
  assert.deepStrictEqual(fs.readdirSync(w).sort(), ['hooks.md', 'skill-build.md', 'skill-plan.md', 'skills.md'], 'changed copies stay');
  const h = fs.readFileSync(path.join(w, 'hooks.md'), 'utf8');
  assert(!h.includes('hook:import-analyse') && h.includes('hook:req-approved-tests') && h.includes('hook:ours'), 'an unedited shipped card goes, a paused retired one and the product\'s own stay');
  fs.writeFileSync(path.join(w, 'hooks.md'), h.replace('status: paused', 'status: active'));
  migrateCopies(prod);
  assert(!fs.readFileSync(path.join(w, 'hooks.md'), 'utf8').includes('hook:req-approved-tests'), 'an unedited retired card goes');
  assert.deepStrictEqual(migrateCopies(prod), [], 'a second pass changes nothing');
  console.log('shipped ok — a product made before keeps only what it changed');
}

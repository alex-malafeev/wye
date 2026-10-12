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

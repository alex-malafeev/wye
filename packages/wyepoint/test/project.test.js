'use strict';
// A project is a page: details in the front matter, a free body with links in it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const analysis = require('../lib/analysis');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-project-'));

test('a project page: description, links and the front matter Wye reads stay in step', () => {
  const dir = tmp(), s = new Store(dir);
  const p = s.createProject({ title: 'Platform', description: 'What it is.', owner: 'Dana' });
  assert.strictEqual(p.description, 'What it is.');
  const body = 'The platform customers use.\n\nMore detail.\n\n## Links\n\n- [Roadmap](https://e.com/roadmap) · link · notion\n- [Runbook](https://e.com/runbook) · link · manual';
  const got = s.updateProject('platform', { title: 'Customer platform', owner: 'Lee', body });
  assert.deepStrictEqual([got.title, got.owner, got.description], ['Customer platform', 'Lee', 'The platform customers use.']);
  assert.deepStrictEqual(got.links.map(l => l.label), ['Roadmap', 'Runbook']);
  const md = fs.readFileSync(path.join(dir, 'teams/platform/_team.md'), 'utf8');
  assert.match(md, /^---\ntitle: Customer platform\nkind: team\nowner: Lee\ndescription: The platform customers use\.\n---\n# Customer platform\n/);
  assert.strictEqual(s.updateProject('platform', { description: 'Changed.' }).description, 'Changed.');
  assert.strictEqual(s.readProject('platform').links.length, 2);              // setting the description keeps the links
  assert.throws(() => s.updateProject('nope', {}), /not found/);
  assert.throws(() => s.updateProject('platform', { title: ' ' }), /title is required/);
});

test('a project written before it was a page (details in the front matter only) reads as one', () => {
  const dir = tmp();                                                            // the layout from before areas: projects/<p>/_project.md
  fs.mkdirSync(path.join(dir, 'projects/old/docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects/old/_project.md'), '---\ntitle: Old\nkind: project\nowner: Sam\ndescription: From the front matter.\n---\n');
  const s = new Store(dir), p = s.projects()[0];
  assert.ok(fs.existsSync(path.join(dir, 'teams/old/_team.md')) && !fs.existsSync(path.join(dir, 'projects')));   // moved over, once
  assert.deepStrictEqual([p.title, p.description, p.body], ['Old', 'From the front matter.', 'From the front matter.']);
});

test('simulating an initiative leaves it out of its own related items', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const a = s.createInitiative({ project: 'p', title: 'Invoice export', owner: 'Dana', status: 'on-track', cycle: 0, approved: true });
  const b = s.createInitiative({ project: 'p', title: 'Invoice archive', owner: 'Lee', status: 'on-track', cycle: 0, approved: true });
  const an = analysis.analyze(s);
  const r = analysis.simulate(an, { title: 'Invoice export', exclude: a.id });
  assert.ok(!r.items.includes(a.id)); assert.ok(r.items.includes(b.id));
  assert.ok(analysis.simulate(an, { title: 'Invoice export' }).items.includes(a.id));
});

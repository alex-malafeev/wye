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

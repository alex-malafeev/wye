'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const cycles = require('../lib/cycles');
const ingest = require('../lib/ingest');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-'));

test('cycles: six weeks plus cooldown, configurable', () => {
  const cfg = { weeks: 6, start: '2026-09-21', cooldown: 7 };
  assert.deepStrictEqual([cycles.cycleOf(cfg, 0).start, cycles.cycleOf(cfg, 0).end], ['2026-09-21', '2026-11-01']);
  assert.strictEqual(cycles.cycleOf(cfg, 1).start, '2026-11-09');
  assert.strictEqual(cycles.cycleAt(cfg, new Date('2026-10-22T10:00:00Z')), 0);
  assert.strictEqual(cycles.cycleAt(cfg, new Date('2026-11-04T00:00:00Z')), 0);   // cooldown belongs to the cycle before
  assert.strictEqual(cycles.cycleAt(cfg, new Date('2026-11-09T00:00:00Z')), 1);
  assert.strictEqual(cycles.cycleOf({ ...cfg, weeks: 4 }, 1).start, '2026-10-26');
});

test('initiative round-trips through Markdown and is a goal node', () => {
  const dir = tmp(), s = new Store(dir);
  s.createProject({ title: 'Web' });
  const it = s.createInitiative({ project: 'web', title: 'Onboarding: v2', description: 'Line one\n## sneaky heading\nline two', owner: 'Dana', effort: 'L', cycle: 2 });
  s.addTask(it.id, { title: 'Checklist', owner: 'Lee' });
  s.addTask(it.id, { title: 'Invite step', status: 'done' });
  s.addLink(it.id, { label: 'Spec [v2]', url: 'https://example.com/a(b)' });
  s.addLog(it.id, { text: 'multi\nline\ttext', source: 'jira ops' });
  const got = s.get(it.id);
  assert.strictEqual(got.title, 'Onboarding: v2');
  assert.strictEqual(got.cycle, 2); assert.strictEqual(got.approved, true);
  assert.strictEqual(got.progress, 50);
  assert.deepStrictEqual(got.tasks.map(t => t.id), ['task:web.onboarding-v2.1', 'task:web.onboarding-v2.2']);
  assert.strictEqual(got.links.length, 1);
  assert.strictEqual(got.log[0].text, 'multi line text'); assert.strictEqual(got.log[0].source, 'jira-ops');
  assert.match(got.description, /sneaky heading/);
  const md = fs.readFileSync(path.join(dir, 'projects/web/docs/onboarding-v2.md'), 'utf8');
  assert.match(md, /^---\nnode: goal:web\.onboarding-v2\n/);
  assert.match(md, /<!-- tasks -->\n- task:web\.onboarding-v2\.1 Checklist #todo \(owner: Lee, part-of: goal:web\.onboarding-v2\)/);
});

test('a duplicate link is added once; updates keep other sections', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const it = s.createInitiative({ project: 'p', title: 'A' });
  s.addLink(it.id, { label: 'x', url: 'https://e.com/1' }); s.addLink(it.id, { label: 'x', url: 'https://e.com/1' });
  s.update(it.id, { status: 'at-risk', owner: 'Sam' });
  const got = s.get(it.id);
  assert.strictEqual(got.links.length, 1);
  assert.strictEqual(got.status, 'at-risk');
  assert.ok(got.log.some(l => /proposed → at-risk/.test(l.text)));
});

test('validation: bad status, bad url, path traversal', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const it = s.createInitiative({ project: 'p', title: 'A' });
  assert.throws(() => s.update(it.id, { status: 'wat' }), /unknown status/);
  assert.throws(() => s.addLink(it.id, { url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => s.get('../../etc/passwd'), /bad initiative id/);
  assert.throws(() => s.get('p/../x'), /bad initiative id/);
  assert.throws(() => s.setConfig({ weeks: 0 }), /weeks/);
});

test('ingest: generic push and the GitHub adapter', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const it = s.createInitiative({ project: 'p', title: 'Billing' });
  ingest.ingest(s, { source: 'jira', initiative: 'billing', kind: 'link', label: 'PROJ-1', url: 'https://j.example/PROJ-1', text: 'PROJ-1 done' });
  ingest.ingest(s, { source: 'jira', initiative: it.id, kind: 'task', title: 'T', status: 'todo' });
  ingest.ingest(s, { source: 'jira', initiative: it.id, kind: 'task', title: 'T', status: 'done' });
  let got = s.get(it.id);
  assert.strictEqual(got.tasks.length, 1); assert.strictEqual(got.tasks[0].status, 'done');
  assert.strictEqual(got.links[0].source, 'jira');
  const r = ingest.github(s, 'pull_request', { action: 'opened', pull_request: { number: 7, title: 'Fix totals tempo:p/billing', html_url: 'https://github.com/o/r/pull/7' } });
  assert.strictEqual(r.initiative, 'p/billing');
  got = s.get(it.id);
  assert.ok(got.links.some(l => l.source === 'github'));
  assert.deepStrictEqual(ingest.github(s, 'pull_request', { pull_request: { number: 8, title: 'unrelated' } }).ignored, 'no tempo:<initiative> reference');
  assert.throws(() => ingest.ingest(s, { initiative: 'nope', kind: 'log', text: 'x' }), /no initiative/);
});

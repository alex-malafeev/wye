'use strict';
// An initiative is one document: items are lines of its body wherever they sit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-body-'));

test('items stay where they were put, and a change to one edits that line', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const it = s.createInitiative({ project: 'p', title: 'Doc', description: 'Intro', ships: 'Thing', risks: 'Risk' });
  const body = 'Intro\n\n- task:p.doc.1 Early milestone #in-progress (owner: Lee, part-of: goal:p.doc)\n\n## What ships\nThing\n\n- [Spec](https://e.com/s) · link · figma\n\n## Risks\nRisk\n\n- 2026-10-22T10:00Z · manual · note';
  const got = s.update(it.id, { body });
  assert.deepStrictEqual([got.tasks.length, got.links.length, got.log.length], [1, 1, 1]);
  assert.deepStrictEqual([got.description, got.ships, got.risks], ['Intro', 'Thing', 'Risk']);
  assert.strictEqual(got.tasks[0].status, 'in-progress');
  assert.ok(got.body.indexOf('Early milestone') < got.body.indexOf('## What ships'));
  s.updateTask(it.id, 'task:p.doc.1', { status: 'done' });
  const after = s.get(it.id).body;
  assert.ok(after.indexOf('#done') > 0 && after.indexOf('#done') < after.indexOf('## What ships'));
  s.update(it.id, { description: 'New intro' });
  assert.strictEqual(s.get(it.id).description, 'New intro');
  assert.strictEqual(s.get(it.id).tasks.length, 1);               // setting a section keeps the items
});

test('an editor saving does not lose what an API push added meanwhile', () => {
  const s = new Store(tmp()); s.createProject({ title: 'P' });
  const it = s.createInitiative({ project: 'p', title: 'Race', description: 'Hello' });
  const base = s.get(it.id).body;                                  // the page as the editor opened it
  s.addLink(it.id, { label: 'pushed', url: 'https://e.com/pushed', source: 'jira' });
  const got = s.update(it.id, { body: base.replace('Hello', 'Hello, edited'), base });
  assert.match(got.description, /Hello, edited/);
  assert.strictEqual(got.links.length, 1);
  assert.strictEqual(s.update(it.id, { body: 'Plain overwrite' }).links.length, 0);   // without a base it is a plain replace
});

test('a page in the older layout (a section for each kind of item) is read as one document', () => {
  const dir = tmp(), s = new Store(dir); s.createProject({ title: 'P' });
  const file = path.join(dir, 'areas/p/docs/old.md');
  fs.writeFileSync(file, '---\nnode: goal:p.old\ntype: doc\ntitle: Old\nstatus: on-track\n---\n# Old\n\nIntro text\n\n## What ships\nA thing\n\n## Risks\nNone\n\n## Links\n- [Spec](https://e.com/spec) · figma\n\n## Pull requests\n- [PR 1](https://e.com/pr1) · 2026-10-20\n\n## Tasks\n<!-- tasks -->\n- task:p.old.1 One #done (owner: Lee, part-of: goal:p.old)\n<!-- /tasks -->\n\n## Log\n- 2026-10-20T09:00Z · manual · started\n');
  const got = s.get('p/old');
  assert.deepStrictEqual([got.description, got.ships, got.risks], ['Intro text', 'A thing', 'None']);
  assert.deepStrictEqual([got.tasks.length, got.links.length, got.prs.length, got.log.length], [1, 1, 1, 1]);
  assert.strictEqual(got.links[0].source, 'figma'); assert.strictEqual(got.prs[0].ts, '2026-10-20');
  s.addLog('p/old', { text: 'later' });
  assert.ok(!/## (Links|Tasks|Log)/.test(fs.readFileSync(file, 'utf8')));   // saved in the new layout
  assert.strictEqual(s.get('p/old').log.length, 2);
});

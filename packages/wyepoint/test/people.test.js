'use strict';
// The people directory: a page in the vault for each person, added by hand for now.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-people-'));

test('a person is a page: role, team, email and where they came from', () => {
  const dir = tmp(), s = new Store(dir);
  const p = s.createPerson({ name: 'Priya Nair', role: 'Data engineer', team: 'Data foundations', email: 'priya@example.com' });
  assert.deepStrictEqual([p.slug, p.name, p.source], ['priya-nair', 'Priya Nair', 'manual']);
  const md = fs.readFileSync(path.join(dir, 'people/priya-nair.md'), 'utf8');
  assert.match(md, /^---\ntitle: Priya Nair\nkind: person\nrole: Data engineer\nteam: Data foundations\nemail: priya@example\.com\nsource: manual\n---\n# Priya Nair\n/);
  assert.strictEqual(s.updatePerson('priya-nair', { team: 'Platform' }).team, 'Platform');
  assert.strictEqual(s.people()[0].name, 'Priya Nair');                      // the name is how initiatives refer to them: not changed here
  s.removePerson('priya-nair'); assert.deepStrictEqual(s.people(), []);
});

test('names are unique whatever the case, an email must look like one, a person must have a name', () => {
  const s = new Store(tmp()); s.createPerson({ name: 'Sam' });
  assert.throws(() => s.createPerson({ name: 'SAM' }), /already in the directory/);
  assert.throws(() => s.createPerson({ name: 'Jo', email: 'not an email' }), /email/);
  assert.throws(() => s.createPerson({ name: '  ' }), /name is required/);
  assert.throws(() => s.updatePerson('nobody', {}), /not found/);
  assert.strictEqual(s.createPerson({ name: 'Sam Two' }).slug, 'sam-two');
});

test('a sync can write the same pages with a source of its own', () => {
  const s = new Store(tmp());
  const p = s.createPerson({ name: 'Kim', source: 'samsara', externalId: 'u-123' });
  assert.deepStrictEqual([p.source, p.externalId], ['samsara', 'u-123']);
});

test('the old roster (a name per line) becomes people, once', () => {
  const dir = tmp(); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_product.md'), '---\ntitle: WyePoint\ncycle-weeks: 6\ncycle-start: 2026-01-05\ncycle-cooldown: 7\n---\n');
  fs.writeFileSync(path.join(dir, '_roster.md'), 'Ann\nBo\nann\n');
  const s = new Store(dir);
  assert.deepStrictEqual(s.people().map(p => p.name), ['Ann', 'Bo']);
  assert.ok(!fs.existsSync(path.join(dir, '_roster.md')));
  assert.strictEqual(new Store(dir).people().length, 2);                    // and not again
});

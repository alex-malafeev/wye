'use strict';
// Links between vaults (plan:vault-links, lib/links.js): a repo link is its URL in _product.md; the path to it is kept
// on this machine only, found from a known vault cloned from that URL or given by the person and checked; the vault
// above and the ones below are reached by name with no link (req:waterfall.vault-links.link, .local-path).
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { initVault, readMeta } = require('../lib/vault');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-links-')));
process.env.WYE_LINKS_FILE = path.join(tmp, 'machine', 'links.json');
const L = require('../lib/links');
const F = rel => path.join(tmp, rel);
const repo = (rel, url) => { fs.mkdirSync(F(rel), { recursive: true }); fs.writeFileSync(F(rel + '/a.ts'), 'export const a = 1;\n'); execFileSync('git', ['init', '-q'], { cwd: F(rel) }); if (url) execFileSync('git', ['remote', 'add', 'origin', url], { cwd: F(rel) }); };

repo('work/org', 'git@github.com:acme/org.git'); repo('work/org/ios');
initVault({ folder: F('work/org') }); initVault({ folder: F('work/org/ios') });
repo('clones/backend', 'https://github.com/acme/backend.git'); initVault({ folder: F('clones/backend') });
repo('elsewhere/backend-2', 'https://github.com/acme/backend'); initVault({ folder: F('elsewhere/backend-2') });
const ios = F('work/org/ios'), home = F('home');
fs.mkdirSync(path.join(home, 'data/products/backend'), { recursive: true });
fs.writeFileSync(path.join(home, 'data/products/backend/_product.md'), `---\ntitle: Backend\nroot: ${F('clones/backend')}/.wye\n---\n`);

// the folder tree links itself: the vault above is `parent`, the one below is its name
assert.deepStrictEqual(L.linkedVaults(ios, home).map(v => [v.name, v.kind]), [['parent', 'parent']]);
assert.strictEqual(L.resolveVault(ios, 'parent', home).folder, F('work/org'));
assert.strictEqual(L.resolveVault(F('work/org'), 'ios', home).folder, ios);

// a repo link: committed as name=URL, one form of the URL, nothing of this machine in it
assert.deepStrictEqual(L.addLink(ios, 'git@github.com:Acme/Backend.git'), { name: 'backend', repo: 'https://github.com/acme/backend' });
const meta = readMeta(ios).md;
assert(/^links: \[backend=https:\/\/github\.com\/acme\/backend\]$/m.test(meta) && !meta.includes(tmp), 'the link is the URL, no path');
assert.throws(() => L.addLink(ios, 'https://github.com/acme/backend'), /already linked/);
assert.throws(() => L.addLink(ios, 'https://github.com/acme/other', 'backend'), /taken/);
assert.throws(() => L.addLink(ios, 'https://github.com/acme/x', 'parent'), /not "parent"/);
assert.throws(() => L.addLink(ios, 'not a url'), /not a repo URL/);
assert.throws(() => L.addLink(F('work/org'), 'https://github.com/acme/org'), /own repo/);

// no path stored: a vault this machine knows with that remote is found and remembered
assert(!fs.existsSync(process.env.WYE_LINKS_FILE));
const v = L.resolveVault(ios, 'backend', home);
assert.strictEqual(v.folder, F('clones/backend')); assert.strictEqual(v.via, 'found');
assert.strictEqual(JSON.parse(fs.readFileSync(process.env.WYE_LINKS_FILE, 'utf8'))['https://github.com/acme/backend'], F('clones/backend'));
assert.strictEqual(L.resolveVault(ios, 'backend', null).via, 'stored');

// the person points it at another clone: checked — a vault, and a clone of that URL
assert.throws(() => L.setPath(ios, 'backend', F('work/org')), /not a clone/);
assert.throws(() => L.setPath(ios, 'backend', F('nowhere')), /no vault/);
assert.throws(() => L.setPath(ios, 'nope', F('elsewhere/backend-2')), /no link named/);
assert.strictEqual(L.setPath(ios, 'backend', F('elsewhere/backend-2/.wye')), F('elsewhere/backend-2'));
assert.strictEqual(L.resolveVault(ios, 'backend', home).folder, F('elsewhere/backend-2'));

// a link with no clone here: the command says to clone it or give the path
L.addLink(ios, 'https://github.com/acme/web');
assert.throws(() => L.resolveVault(ios, 'web', home), e => e.code === 'no-path' && /git clone https:\/\/github\.com\/acme\/web/.test(e.message) && /wye link web --path/.test(e.message));
assert.throws(() => L.resolveVault(ios, 'billing', home), e => e.code === 'unknown' && /linked: parent, backend, web/.test(e.message));
assert.deepStrictEqual(L.linkedVaults(ios, home).map(x => [x.name, x.kind, !!x.folder]), [['parent', 'parent', true], ['backend', 'repo', true], ['web', 'repo', false]]);

L.removeLink(ios, 'web');
assert.deepStrictEqual(L.repoLinks(ios).map(l => l.name), ['backend']);
L.removeLink(ios, 'backend');
assert(!/^links:/m.test(readMeta(ios).md), 'the last link removed leaves no key');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('links ok — the tree links itself, a repo link is its URL, the path is this machine\'s, found or given and checked');

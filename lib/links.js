'use strict';
// Links between vaults (plan:vault-links). A vault reaches the vault above it and the ones below through the folder
// tree (`parent:` / `vaults:`, lib/vault.js — no link to add, decision:waterfall.parent-vaults-are-linked-by-folder),
// and a vault in another repo through `links:` in its _product.md: a name and the repo's URL, committed, the same for
// every teammate. Where that repo sits on this machine is never in git (decision:waterfall.vault-link-is-repo-url-path-is-local):
// a per-machine store keyed by the URL, filled from a vault this machine already knows whose git remote is that URL,
// or from the path the person gives — Wye never clones or touches the other repo itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { hasVault, readMeta, setMeta, links: treeLinks } = require('./vault');

// a repo URL in one form for comparing: https://github.com/o/r, from https, ssh or git@ forms, with or without .git
function repoUrl(s) {
  const m = String(s || '').trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[:/]([^\s]+?)(?:\.git)?\/?$/i);
  if (!m || !m[2].includes('/')) return null;
  return `https://${m[1]}/${m[2].replace(/^\/+/, '')}`.toLowerCase();
}
const nameOk = n => /^[a-z0-9][a-z0-9_-]*$/.test(n) && n !== 'parent';
const defaultName = url => url.split('/').pop().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

// `links: [backend=https://github.com/o/backend, …]` → [{ name, repo }]
function repoLinks(folder) {
  const fm = readMeta(folder).md.match(/^---\n([\s\S]*?)\n---/);
  const v = ((fm && fm[1].match(/^links:\s*(.*)$/m)) || [])[1] || '';
  return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const i = s.indexOf('='); return i > 0 ? { name: s.slice(0, i).trim(), repo: repoUrl(s.slice(i + 1)) } : null; })
    .filter(l => l && l.repo);
}
const writeLinks = (folder, ls) => setMeta(folder, { links: ls.length ? `[${ls.map(l => `${l.name}=${l.repo}`).join(', ')}]` : '' });

// the remotes of the git repo a folder is in, in repoUrl form
function remotes(folder) {
  try { return execFileSync('git', ['-C', folder, 'config', '--get-regexp', '^remote\\..*\\.url$'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map(l => repoUrl(l.split(/\s+/)[1])).filter(Boolean); } catch { return []; }
}

// ------------------------------------------------------------------ this machine's paths
const storeFile = () => process.env.WYE_LINKS_FILE || path.join(process.env.WYE_HOME ? path.resolve(process.env.WYE_HOME) : path.join(os.homedir(), '.wye'), 'links.json');
const readStore = () => { try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return {}; } };
function remember(repo, folder) { const s = readStore(); if (s[repo] === folder) return; s[repo] = folder; fs.mkdirSync(path.dirname(storeFile()), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2) + '\n'); }
// the vault folders the app on this machine knows: <home>/data/products/*/_product.md `root: <folder>/.wye`
function knownVaults(home) {
  const dir = path.join(home, 'data', 'products'); const out = [];
  let ents = []; try { ents = fs.readdirSync(dir); } catch { return out; }
  for (const e of ents) { let md = ''; try { md = fs.readFileSync(path.join(dir, e, '_product.md'), 'utf8'); } catch { continue; } const r = (md.match(/^root:\s*(.+)$/m) || [])[1]; if (r) out.push(path.dirname(r.trim())); }
  return out.filter(hasVault);
}
// a folder given by the person: the vault folder itself, or its .wye
const vaultFolder = dir => { const d = path.resolve(dir); return path.basename(d) === '.wye' ? path.dirname(d) : d; };

// ------------------------------------------------------------------ changing the links
function addLink(folder, url, name) {
  const repo = repoUrl(url); if (!repo) throw new Error(`not a repo URL: ${url} (e.g. https://github.com/<owner>/<repo>)`);
  name = name || defaultName(repo);
  if (!nameOk(name)) throw new Error(`a link name is lowercase letters, digits, - and _, and not "parent": ${name}`);
  if (remotes(folder).includes(repo)) throw new Error(`${repo} is this vault's own repo — the vaults above and below in it are linked by folder already`);
  const ls = repoLinks(folder);
  if (ls.some(l => l.repo === repo)) throw new Error(`already linked: ${ls.find(l => l.repo === repo).name} = ${repo}`);
  if (ls.some(l => l.name === name) || childName(folder, name)) throw new Error(`the name ${name} is taken — pass --name`);
  writeLinks(folder, [...ls, { name, repo }]);
  return { name, repo };
}
function removeLink(folder, name) {
  const ls = repoLinks(folder); if (!ls.some(l => l.name === name)) throw new Error(`no link named ${name}`);
  writeLinks(folder, ls.filter(l => l.name !== name));
}
// set where a linked repo is on this machine: the folder must hold a vault whose repo has that URL as a remote
function setPath(folder, name, dir) {
  const l = repoLinks(folder).find(x => x.name === name); if (!l) throw new Error(`no link named ${name} — add it first: wye link <repo URL> --name ${name}`);
  const f = vaultFolder(dir);
  if (!hasVault(f)) throw new Error(`${f} has no vault (.wye/_product.md) — run wye init there first`);
  if (!remotes(f).includes(l.repo)) throw new Error(`${f} is not a clone of ${l.repo} (its remotes: ${remotes(f).join(', ') || 'none'})`);
  remember(l.repo, f); return f;
}

// ------------------------------------------------------------------ reading them
const slugOf = f => readMeta(f).slug || path.basename(f);
const childName = (folder, name) => treeLinks(folder).vaults.find(c => slugOf(c) === name) || null;
const gitTop = folder => { try { return fs.realpathSync(execFileSync('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return null; } };
// where a linked repo is here — the folder of its clone: the stored path while it still holds a vault, else the clone
// of a vault this machine knows whose remote is that URL (stored)
function pathOf(repo, home) {
  const s = readStore()[repo];
  if (s && hasVault(s)) return { folder: s, via: 'stored' };
  const hit = home ? knownVaults(home).find(f => remotes(f).includes(repo)) : null;
  const top = hit && gitTop(hit);
  if (top && hasVault(top)) { remember(repo, top); return { folder: top, via: 'found' }; }
  return { folder: null, via: null };
}

// How vault `to` names vault `from` so that a reply finds its way back on any machine: a path between the two when they
// sit in one repo (../ios), else the repo URL of `from`, with `#<folder in the repo>` when its vault is not at the top.
function addressOf(from, to) {
  const ft = gitTop(from), tt = gitTop(to);
  if (!ft || ft === tt) return path.relative(to, from).split(path.sep).join('/') || '.';
  const url = remotes(from)[0]; if (!url) return path.resolve(from);   // a repo with no remote: this machine's path
  const sub = path.relative(ft, fs.realpathSync(from)).split(path.sep).join('/');
  return sub ? `${url}#${sub}` : url;
}
// …and back: the vault folder an address names, seen from vault `base`, or null when it is not on this machine
function folderOf(base, address, home) {
  const a = String(address || '').trim(); if (!a) return null;
  const [u, sub] = a.split('#'); const repo = repoUrl(u);
  if (repo && /[:@]|^https?:/.test(u)) { const p = pathOf(repo, home); const f = p.folder && (sub ? path.join(p.folder, sub) : p.folder); return f && hasVault(f) ? f : null; }
  const f = path.resolve(base, a); return hasVault(f) ? f : null;
}
// every vault this one reaches: [{ name, kind: parent|child|repo, folder, repo? }] — folder null for a repo with no path here
function linkedVaults(folder, home) {
  const t = treeLinks(folder); const out = [];
  if (t.parent) out.push({ name: 'parent', kind: 'parent', folder: t.parent, slug: slugOf(t.parent) });
  for (const c of t.vaults) out.push({ name: slugOf(c), kind: 'child', folder: c, slug: slugOf(c) });
  for (const l of repoLinks(folder)) { const p = pathOf(l.repo, home); out.push({ name: l.name, kind: 'repo', repo: l.repo, folder: p.folder, via: p.via, slug: p.folder ? slugOf(p.folder) : null }); }
  return out;
}
// a name → the vault folder it means; a repo link with no path here stops with what the person can do
function resolveVault(folder, name, home) {
  const v = linkedVaults(folder, home).find(x => x.name === name || (x.kind !== 'repo' && x.slug === name));
  if (!v) {
    const names = linkedVaults(folder, home).map(x => x.name);
    const e = new Error(name === 'parent' ? 'this vault has no vault above it' : `no linked vault named ${name}${names.length ? ` — linked: ${names.join(', ')}` : ' — link one: wye link <repo URL> --name <name>'}`); e.code = 'unknown'; throw e;
  }
  if (!v.folder) { const e = new Error(`${v.name} (${v.repo}) is not on this machine. Clone it (git clone ${v.repo}), or if it is cloned already, say where: wye link ${v.name} --path <folder>`); e.code = 'no-path'; e.link = v; throw e; }
  return v;
}

module.exports = { addressOf, folderOf, repoUrl, repoLinks, remotes, addLink, removeLink, setPath, linkedVaults, resolveVault, knownVaults, storeFile };

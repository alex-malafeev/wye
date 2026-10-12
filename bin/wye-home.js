'use strict';
// Wye's home: a folder laid out like the Wye checkout, which is what the app and its agents read and write. Running from
// a clone, it is the clone itself. Installed from npm, it is ~/.wye (or WYE_HOME): `data/` holds the person's products
// and stays theirs across updates; the code folders are links into the installed package, so an update swaps the code
// under the same paths and every `data/products/<product>/…` path an agent is told keeps working.
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTALL = path.resolve(__dirname, '..');
// the folders of the package the home links to (what REPO_ROOT-relative code reads: prompts, schema, templates…)
const CODE = ['bin', 'lib', 'packages', 'prompts', 'schema', 'skills', 'templates', 'viewer', 'package.json'];

// a clone has its own data/products; an installed package does not
const isCheckout = () => fs.existsSync(path.join(INSTALL, 'data', 'products'));

function home() {
  if (process.env.WYE_HOME) return path.resolve(process.env.WYE_HOME);
  return isCheckout() ? INSTALL : path.join(os.homedir(), '.wye');
}

// Make the home ready: data/products, and a link per code folder pointing at this install (relinked when the install
// moved, e.g. a new Node version's global folder). A clone needs nothing.
function ensureHome() {
  const h = home();
  if (h === INSTALL) return h;
  fs.mkdirSync(path.join(h, 'data', 'products'), { recursive: true });
  for (const name of CODE) {
    const target = path.join(INSTALL, name), link = path.join(h, name);
    if (!fs.existsSync(target)) continue;
    let cur = null; try { cur = fs.readlinkSync(link); } catch { /* none yet, or a real folder */ }
    if (cur === target) continue;
    if (cur !== null || !fs.existsSync(link)) { try { fs.unlinkSync(link); } catch { /* not there */ } fs.symlinkSync(target, link); }
    else console.error(`wye: ${link} is a real ${fs.statSync(link).isDirectory() ? 'folder' : 'file'}, not a link to the package — left as it is`);
  }
  return h;
}

// Wye's agent skills (skills/wye-*) linked once per machine where the agents read them — Claude Code in
// ~/.claude/skills, Codex in ~/.agents/skills — never into a repo (req:waterfall.global-skills.agent-skills). Run on
// every `wye` call and app start, so an upgrade links the skills it adds and removes the links of the ones it dropped:
// a link is Wye's when it points at a skills/wye-* folder; a real folder or a link elsewhere under that name is left
// alone and reported. Returns the links (`.left` names what was left alone).
const SKILL_HOMES = () => [path.join(os.homedir(), '.claude', 'skills'), path.join(os.homedir(), '.agents', 'skills')];
const isWyeLink = to => /[\/\\]skills[\/\\]wye-[^\/\\]+$/.test(to);
function linkSkills(homes = SKILL_HOMES()) {
  const ours = fs.readdirSync(path.join(INSTALL, 'skills'), { withFileTypes: true }).filter(s => s.isDirectory()).map(s => s.name);
  const out = []; out.left = [];
  for (const dir of homes) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ours) {
      const link = path.join(dir, name), target = path.join(INSTALL, 'skills', name);
      let cur = null; try { cur = fs.readlinkSync(link); } catch { /* none, or a real folder */ }
      if (cur === target) { out.push(link); continue; }
      if (cur === null && fs.existsSync(link)) { out.left.push(link); continue; }
      if (cur !== null && !isWyeLink(cur)) { out.left.push(link); continue; }
      if (cur !== null) fs.unlinkSync(link);
      fs.symlinkSync(target, link); out.push(link);
    }
    // the links to a skill this install no longer has
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('wye-') || ours.includes(name)) continue;
      let cur = null; try { cur = fs.readlinkSync(path.join(dir, name)); } catch { continue; }
      if (isWyeLink(cur)) fs.unlinkSync(path.join(dir, name));
    }
  }
  return out;
}
// quiet and cheap: what every `wye` call and the app's start do — only touches the links when one is wrong;
function keepSkillsLinked() { try { return cliStatus().installed ? linkSkills() : []; } catch { return []; } }   // the install the `wye` command is, only — with several clones the links follow the command

// The `wye` command: ~/.local/bin/wye → this install's bin/wye.js (what install.sh does). A real file already there is left alone.
function cliPath() { return path.join(os.homedir(), '.local', 'bin', 'wye'); }
function cliStatus() {
  const link = cliPath(), target = path.join(INSTALL, 'bin', 'wye.js'), dir = path.dirname(link);
  let cur = null; try { cur = fs.readlinkSync(link); } catch { /* none, or a real file */ }
  return { link, target, installed: cur === target, elsewhere: cur !== null && cur !== target && fs.existsSync(link), blocked: cur === null && fs.existsSync(link), onPath: (process.env.PATH || '').split(path.delimiter).includes(dir), dir };
}
function linkCli() {
  const st = cliStatus();
  if (st.blocked) throw new Error(`${st.link} is a real file, not a link — left as it is`);
  fs.mkdirSync(st.dir, { recursive: true });
  for (const f of ['wye.js', 'wye-graph.js']) fs.chmodSync(path.join(INSTALL, 'bin', f), 0o755);
  try { fs.unlinkSync(st.link); } catch { /* none yet */ }
  fs.symlinkSync(st.target, st.link);
  return cliStatus();
}

// The folder `next start` runs in. Turbopack loads the server's external packages (next.config.ts
// serverExternalPackages) through hashed aliases in .next/node_modules — `@duckdb/node-api-<hash>` → the package — which
// npm cannot pack (symlinks), so the package carries their names (.next/wye-externals.json, scripts/externals-manifest.js)
// and they are made here: in the installed app when it is writable, else in a copy of the built app under the home
// (<home>/.cache/app/<build>), one per build. A clone's build has its own links and runs where it is.
function prepareApp(web, homeDir) {
  const next = path.join(web, '.next');
  if (fs.existsSync(path.join(next, 'node_modules'))) return web;
  let map; try { map = JSON.parse(fs.readFileSync(path.join(next, 'wye-externals.json'), 'utf8')); } catch { return web; }
  let dir = web;
  try { fs.accessSync(next, fs.constants.W_OK); } catch {
    const build = fs.readFileSync(path.join(next, 'BUILD_ID'), 'utf8').trim();
    dir = path.join(homeDir, '.cache', 'app', build);
    if (!fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of ['package.json', 'next.config.ts']) fs.copyFileSync(path.join(web, f), path.join(dir, f));
      fs.cpSync(next, path.join(dir, '.next'), { recursive: true });
      fs.symlinkSync(path.join(INSTALL, 'node_modules'), path.join(dir, 'node_modules'));
    }
  }
  for (const [alias, pkg] of Object.entries(map)) {
    let target = null;   // the package folder: the first node_modules/<pkg> walking up from the installed app
    for (let d = web; ; d = path.dirname(d)) { const t = path.join(d, 'node_modules', pkg); if (fs.existsSync(path.join(t, 'package.json'))) { target = t; break; } if (path.dirname(d) === d) break; }
    if (!target) { console.error(`wye: ${pkg} is not installed — reinstall the package`); continue; }
    const link = path.join(dir, '.next', 'node_modules', alias); fs.mkdirSync(path.dirname(link), { recursive: true });
    try { fs.unlinkSync(link); } catch { /* none yet */ }
    fs.symlinkSync(target, link);
  }
  return dir;
}

module.exports = { keepSkillsLinked, SKILL_HOMES, INSTALL, home, ensureHome, linkSkills, linkCli, cliStatus, prepareApp, isCheckout };

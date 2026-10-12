'use strict';
// Wye's agent skills reach Claude Code and Codex from the install (bin/wye-home linkSkills,
// req:waterfall.global-skills.agent-skills): every skills/wye-* linked in each home; a link to a skill the install no
// longer has is removed; what is not Wye's under those names is left alone; a second run changes nothing.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { linkSkills, INSTALL } = require('../bin/wye-home');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wye-agent-skills-')));
const claude = path.join(tmp, '.claude/skills'), codex = path.join(tmp, '.agents/skills');
const ours = fs.readdirSync(path.join(INSTALL, 'skills')).filter(n => fs.statSync(path.join(INSTALL, 'skills', n)).isDirectory());
fs.mkdirSync(codex, { recursive: true });
fs.mkdirSync(path.join(codex, 'impeccable'));                                              // another tool's skill
fs.mkdirSync(path.join(codex, ours[0]));                                                   // a real folder under one of our names
fs.symlinkSync(path.join(tmp, 'old/skills/wye-gone'), path.join(codex, 'wye-gone'));       // a skill an older Wye shipped

const out = linkSkills([claude, codex]);
for (const n of ours) assert.strictEqual(fs.readlinkSync(path.join(claude, n)), path.join(INSTALL, 'skills', n), `${n} linked for Claude Code`);
for (const n of ours.slice(1)) assert.strictEqual(fs.readlinkSync(path.join(codex, n)), path.join(INSTALL, 'skills', n), `${n} linked for Codex`);
assert(fs.statSync(path.join(codex, ours[0])).isDirectory() && !fs.lstatSync(path.join(codex, ours[0])).isSymbolicLink(), 'a real folder is left alone');
assert.deepStrictEqual(out.left, [path.join(codex, ours[0])], 'and reported');
assert(!fs.existsSync(path.join(codex, 'wye-gone')) && fs.existsSync(path.join(codex, 'impeccable')), 'a gone skill\'s link is removed, another tool\'s skill stays');
const before = fs.readdirSync(claude).map(n => fs.lstatSync(path.join(claude, n)).mtimeMs).join();
linkSkills([claude, codex]);
assert.strictEqual(fs.readdirSync(claude).map(n => fs.lstatSync(path.join(claude, n)).mtimeMs).join(), before, 'a second run changes nothing');
console.log(`agent skills ok — ${ours.length} linked for Claude Code and Codex, gone ones removed, others left alone`);

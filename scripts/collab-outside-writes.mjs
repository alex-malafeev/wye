// plan:collaboration phase 3 — a page open in two browsers, one person typing; meanwhile the CLI writes to it (wye doc
// write, wye propose, wye node set). Every write shows in both editors without a reload, the typing stays, the file
// holds both.
//   WYE_URL=<app> node scripts/collab-outside-writes.mjs <page URL> <product/project/doc> <the page's .md file> <a prose node id on it>
// Needs playwright-core (PLAYWRIGHT_CORE=<its package dir>) and Chrome. Run it against a fresh scratch page: a second run
// proposes a card like the first one, which propose refuses as a near copy.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const [url, ref, file, node] = process.argv.slice(2);
if (!node) { console.error('WYE_URL=<app> node scripts/collab-outside-writes.mjs <page URL> <product/project/doc> <file> <node id>'); process.exit(2); }
const product = ref.split('/')[0];
const wye = (args, input) => execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'wye.js'), ...args, '--product', product], { input, encoding: 'utf8', env: process.env });
const mark = `W${Date.now().toString(36)}`;
const b = await chromium.launch({ channel: 'chrome' });
const open = async () => { const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 }); await p.locator('.save-state', { hasText: 'live' }).first().waitFor({ timeout: 180000 }); return { p, errors }; };
const text = p => p.locator('.bn-editor').evaluate(el => { const c = el.cloneNode(true); c.querySelectorAll('[class*=collaboration-cursor]').forEach(x => x.remove()); document.body.appendChild(c); const t = c.innerText; c.remove(); return t.replace(/⁠/g, '').replace(/\s+/g, ' ').trim(); });
const A = await open(), B = await open();
// A types into the first paragraph for a few seconds; the writes land meanwhile
await A.p.locator('.bn-editor [data-content-type="paragraph"]').first().click(); await A.p.keyboard.press('End');
const typing = A.p.keyboard.type(` ${mark}typed by a person while agents write`, { delay: 90 });
await A.p.waitForTimeout(700);
const body = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
wye(['doc', 'write', ref], body.trimEnd() + `\n\nA paragraph the CLI wrote ${mark}.\n`);
await A.p.waitForTimeout(500);
wye(['propose', ref], `- id: decision:${product}.${mark.toLowerCase()}\n  title: A decision an agent proposed ${mark}\n  status: proposed\n`);
await A.p.waitForTimeout(500);
wye(['node', 'set', node, '--status', 'approved']);
await typing;
const want = [`${mark}typed by a person while agents write`, `A paragraph the CLI wrote ${mark}.`, `A decision an agent proposed ${mark}`];
const t0 = Date.now(); let ta = '', tb = '', md = '';
while (Date.now() - t0 < 10000) {
  ta = await text(A.p); tb = await text(B.p); md = readFileSync(file, 'utf8');
  if (ta === tb && want.every(w => ta.includes(w) && md.includes(w)) && md.includes(`${node} `) && /#approved|status: approved/.test(md)) break;
  await A.p.waitForTimeout(300);
}
const conflict = [];
for (const [n, x] of [['A', A], ['B', B]]) if (/changed on disk|reload/i.test(await x.p.locator('body').innerText())) conflict.push(n);
for (const w of want) console.log(`${w.slice(0, 50).padEnd(50)}  A: ${ta.includes(w)}  B: ${tb.includes(w)}  file: ${md.includes(w)}`);
console.log(`${node} approved in the file: ${new RegExp(node.replace(/[.]/g, '\\.') + '[^\\n]*#approved').test(md)} · editors converged: ${ta === tb} · conflict shown in: ${conflict.join(', ') || 'none'} · page errors: ${A.errors.length + B.errors.length}`);
// the person's paragraph stays above the node line, the writer's paragraph below it
const order = md.indexOf(`${mark}typed`) < md.indexOf(`${node} `) && md.indexOf(`${node} `) < md.indexOf(`A paragraph the CLI wrote ${mark}`);
console.log(`blocks in their places: ${order}`);
const ok = order && ta === tb && want.every(w => ta.includes(w) && tb.includes(w) && md.includes(w)) && !conflict.length;
await b.close(); process.exit(ok ? 0 : 1);

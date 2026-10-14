// plan:collaboration phase 2 — two browsers on one page type into one paragraph at the same moment: both editors show
// the same page, the file has both edits within seconds, and neither shows a conflict or a reload message.
//   node scripts/collab-two-browsers.mjs <page URL> <the page's .md file> [<the paragraph's text>]
// Needs playwright-core (PLAYWRIGHT_CORE=<its package dir> if it is not installed here) and Chrome. Run it against a
// scratch product (the page is typed into).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const [url, file, words = 'The first paragraph'] = process.argv.slice(2);
if (!url || !file) { console.error('node scripts/collab-two-browsers.mjs <page URL> <file> [<paragraph text>]'); process.exit(2); }
const mark = `T${Date.now().toString(36)}`;
const b = await chromium.launch({ channel: 'chrome' });
const open = async () => {
  const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.locator('.save-state', { hasText: 'live' }).first().waitFor({ timeout: 180000 });
  return { p, errors };
};
const A = await open(), B = await open();
const para = p => p.locator('.bn-editor [data-content-type="paragraph"]', { hasText: words }).first();
// the page as text, without the other people's cursors
const text = p => p.locator('.bn-editor').evaluate(el => { const c = el.cloneNode(true); c.querySelectorAll('[class*=collaboration-cursor]').forEach(x => x.remove()); document.body.appendChild(c); const t = c.innerText; c.remove(); return t.replace(/⁠/g, '').replace(/\s+/g, ' ').trim(); });
await para(A.p).click({ position: { x: 2, y: 5 } }); await A.p.keyboard.press('Home');
await para(B.p).click(); await B.p.keyboard.press('End');
await Promise.all([A.p.keyboard.type(`${mark}A `, { delay: 40 }), B.p.keyboard.type(` ${mark}B`, { delay: 40 })]);
const t0 = Date.now(); let ta = '', tb = '', stored = false;
while (Date.now() - t0 < 8000) {
  ta = await text(A.p); tb = await text(B.p); stored = (s => s.includes(`${mark}A`) && s.includes(`${mark}B`))(readFileSync(file, 'utf8'));
  if (ta === tb && stored) break; await A.p.waitForTimeout(250);
}
const conflict = [];
for (const [n, x] of [['A', A], ['B', B]]) if (/changed on disk|reload/i.test(await x.p.locator('body').innerText())) conflict.push(n);
const ok = ta === tb && ta.includes(`${mark}A`) && ta.includes(`${mark}B`) && stored && !conflict.length && !A.errors.length && !B.errors.length;
console.log(`converged: ${ta === tb} · file has both: ${stored} (${Date.now() - t0} ms after typing) · conflict shown in: ${conflict.join(', ') || 'none'} · page errors: ${A.errors.length + B.errors.length}`);
await b.close();
process.exit(ok ? 0 : 1);

// plan:collaboration phase 4 — two people on one page of a server (not localhost): each is asked their name once, sees
// the other at the top of the page, the other's labelled cursor and the block they are in, the rail marks the page
// with both, and a node one of them changes is recorded under their name.
//   node scripts/collab-presence.mjs <port> <product>/<project>/<slug> <a prose node id on the page>
// Chrome reaches the app as http://wye.test:<port> (mapped to this machine), so the app takes itself for a server —
// or through a TLS proxy: WYE_TEST_BASE=https://wye.test:8443 WYE_TEST_AUTH=<user>:<password> (its basic auth).
// Needs playwright-core (PLAYWRIGHT_CORE=<its package dir>) and Chrome. Run it against a scratch product.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const [port, ref, node] = process.argv.slice(2);
if (!node) { console.error('node scripts/collab-presence.mjs <port> <product/project/slug> <node id>'); process.exit(2); }
const [product, project, slug] = ref.split('/');
const base = process.env.WYE_TEST_BASE ?? `http://wye.test:${port}`, url = `${base}/${product}/${project}/d/${slug}`;
const b = await chromium.launch({ channel: 'chrome', args: ['--host-resolver-rules=MAP wye.test 127.0.0.1', '--ignore-certificate-errors'] });
const results = [];
const check = (what, ok) => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const join = async name => {
  const [username, password] = (process.env.WYE_TEST_AUTH ?? '').split(':');
  const p = await (await b.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true, ...(username ? { httpCredentials: { username, password } } : {}) })).newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const ask = p.getByRole('dialog', { name: 'Your name' }); await ask.waitFor({ timeout: 60000 });
  await ask.getByLabel('Your name').fill(name); await ask.getByRole('button', { name: 'Continue' }).click();
  await p.locator('.save-state', { hasText: 'live' }).first().waitFor({ timeout: 180000 });
  return { p, errors, name };
};
const A = await join('Ada'), B = await join('Grace');
check('asked once: no name dialog after the reload', !(await A.p.getByRole('dialog', { name: 'Your name' }).count()));
const chips = p => p.locator('.page-presence .pp-chip').evaluateAll(es => es.map(e => e.getAttribute('data-person')));
await A.p.waitForTimeout(1500);
check(`both at the top of the page — A sees ${JSON.stringify(await chips(A.p))}, B sees ${JSON.stringify(await chips(B.p))}`, (await chips(A.p)).sort().join() === 'Ada,Grace' && (await chips(B.p)).sort().join() === 'Ada,Grace');
// Grace goes into the node's line and types
const line = B.p.locator('.bn-block-outer', { has: B.p.locator(`[data-content-type="node"]`) }).first();
const blockId = await line.getAttribute('data-id');
await line.locator('[data-content-type="node"] .bn-inline-content').first().click(); await B.p.keyboard.press('End'); await B.p.keyboard.type(' edited by Grace', { delay: 30 });
await A.p.waitForTimeout(1200);
const label = await A.p.locator('[class*=collaboration-cursor] [class*=label], [class*=collaboration-cursor__label]').allInnerTexts();
check(`Grace's labelled cursor in Ada's editor (${JSON.stringify(label)})`, label.some(t => t.includes('Grace')));
const marked = await A.p.locator(`.bn-block[data-id="${blockId}"] .bn-block-content`).first().evaluate(e => getComputedStyle(e).boxShadow);
check(`the block Grace is in is marked in her colour for Ada (${marked})`, marked && marked !== 'none');
await A.p.waitForTimeout(6000);
const here = await A.p.locator('.pg-here').first().getAttribute('title').catch(() => null);
check(`the rail marks the page with both (${here})`, !!here && here.includes('Ada') && here.includes('Grace'));
// the store credits Grace: the node's change is recorded under her name
let rec = null; const t0 = Date.now();
while (Date.now() - t0 < 15000 && !rec) { const j = await (await fetch(`http://localhost:${port}/api/${product}/changes?all=1&node=${encodeURIComponent(node)}`)).json(); rec = (j.changes ?? []).find(c => /Grace/.test(c.by ?? '')); if (!rec) await new Promise(r => setTimeout(r, 1000)); }
check(`the change to ${node} is recorded under Grace (${rec ? rec.by : 'none'})`, !!rec);
check(`no page errors (${A.errors.length + B.errors.length})`, !A.errors.length && !B.errors.length);
await b.close(); process.exit(results.every(Boolean) ? 0 : 1);

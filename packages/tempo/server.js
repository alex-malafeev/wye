'use strict';
// Tempo: a web app over a Wye vault. No dependencies — Node's http, the vault's Markdown, a static page.
//   node server.js [--vault <folder>] [-p 4400] [-H 127.0.0.1] [--public https://tempo.example.com] [--seed]
// Reading is open (that is what "public" means); writing needs the token — TEMPO_TOKEN, or one generated at start —
// except from this machine while the server is bound to loopback only. The status agents spend model calls, so they
// need the token too, even where writing does not.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store, STATUSES, TASK_STATUSES, EFFORTS, BUCKETS } = require('./lib/store');
const analysis = require('./lib/analysis');
const ingest = require('./lib/ingest');
const agent = require('./lib/agent');

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const vault = path.resolve(opt('--vault', process.env.TEMPO_VAULT || path.join(process.env.HOME || '.', '.wye', 'data', 'products', 'tempo')));
const port = Number(opt('-p', process.env.PORT || 4400));
const publicUrl = opt('--public', process.env.TEMPO_PUBLIC_URL || '');
const host = opt('-H', publicUrl ? '0.0.0.0' : '127.0.0.1');
const loopbackOnly = !publicUrl && ['127.0.0.1', 'localhost', '::1'].includes(host);
const token = process.env.TEMPO_TOKEN || crypto.randomBytes(18).toString('base64url');
const ghSecret = process.env.TEMPO_GITHUB_SECRET || '';

const store = new Store(vault);
if (args.includes('--seed') && store.isEmpty()) require('./lib/seed')(store);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const PUB = path.join(__dirname, 'public');

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseJson = buf => { try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw Object.assign(new Error('body is not JSON'), { status: 400 }); } };
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function mayWrite(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (m && same(m[1], token)) return true;
  return loopbackOnly && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
}
const fail = (status, message) => Object.assign(new Error(message), { status });

// a cycle as the History view shows it: its snapshot once closed, otherwise the initiatives that are in it now
function cycleRows(a, c) {
  if (c.status === 'closed' && c.snap.length) return c.snap;
  return a.items.filter(i => i.cycle === c.n).map(analysis.snapshotOf).map(r => (c.status === 'planned' || c.status === 'released') ? { ...r, status: '', pct: 0 } : r);
}

function state() {
  const a = analysis.analyze(store), { ctx } = a;
  const cycles = a.cycles.map(c => { const rows = cycleRows(a, c); return { ...c, snap: undefined, snapshot: c.status === 'closed' && c.snap.length > 0, rows, shipped: rows.filter(r => r.status === 'complete').length, avg: rows.length ? Math.round(rows.reduce((s, r) => s + (r.pct || 0), 0) / rows.length) : 0 }; });
  return {
    brand: 'Tempo', config: ctx.cfg, today: ctx.todayIso, active: ctx.active, nx: ctx.nx.n, cycles, projects: ctx.projects, initiatives: a.items, people: a.people,
    checks: a.checks, canRelease: a.canRelease, roster: ctx.roster.join('\n'),
    enums: { statuses: STATUSES, taskStatuses: TASK_STATUSES, efforts: EFFORTS, buckets: BUCKETS, labels: analysis.LABEL },
  };
}

// ---- moving between cycles
function release() {
  const a = analysis.analyze(store);
  if (a.ctx.nx.status !== 'planned') throw fail(409, 'the next cycle is already released');
  if (!a.canRelease) throw fail(409, 'release needs at least one planned item, and every planned item approved');
  store.saveCycle(a.ctx.nx.n, { status: 'released', releasedAt: a.ctx.todayIso });
}
function reopen() {
  const a = analysis.analyze(store);
  if (a.ctx.nx.status !== 'released') throw fail(409, 'the next cycle is not released');
  store.saveCycle(a.ctx.nx.n, { status: 'planned', releasedAt: '' });
}
// closes the active cycle with a snapshot of it; what was not shipped becomes carry-over (its cycle number stays, so it shows as one)
function startNext() {
  const a = analysis.analyze(store), n = a.ctx.active;
  if (a.ctx.nx.status !== 'released') throw fail(409, 'release the next cycle plan first');
  const live = a.items.filter(i => i.tier === 'cycle');
  store.saveCycle(n, { status: 'closed', closedAt: a.ctx.todayIso, snap: live.map(analysis.snapshotOf) });
  live.filter(i => i.status !== 'complete').forEach(i => store.addLog(i.id, { text: `Not shipped in Cycle ${n}; carried over`, source: 'tempo' }));
  store.saveCycle(n + 1, { status: 'active' });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent), method = req.method;
  const [a, b, c, d] = parts;
  if (method === 'GET' && a === 'state') return json(res, 200, state());
  if (method === 'GET' && a === 'health') return json(res, 200, { ok: true });

  // GitHub signs its own deliveries; everything else that changes something needs the token
  if (method === 'POST' && a === 'ingest' && b === 'github') {
    const raw = await readBody(req);
    if (!ghSecret) return json(res, 503, { error: 'set TEMPO_GITHUB_SECRET to accept GitHub webhooks' });
    if (!ingest.verifySignature(ghSecret, raw, req.headers['x-hub-signature-256'])) return json(res, 401, { error: 'bad signature' });
    return json(res, 200, ingest.github(store, req.headers['x-github-event'], parseJson(raw)));
  }
  const readOnly = method === 'POST' && a === 'simulate';     // works out who an idea touches; changes nothing
  if (method !== 'GET' && !readOnly && !mayWrite(req)) return json(res, 401, { error: 'a token is needed to change anything' });
  const body = method === 'GET' || method === 'DELETE' ? {} : parseJson(await readBody(req));

  if (a === 'config' && method === 'PATCH') return json(res, 200, store.setConfig(body));
  if (a === 'roster' && method === 'PUT') { store.setRoster(String(body.text || '').split('\n')); return json(res, 200, { roster: store.roster().join('\n') }); }
  if (a === 'ingest' && method === 'POST') return json(res, 200, ingest.ingest(store, body));
  if (a === 'cycles') {
    if (method === 'POST' && b === 'release') { release(); return json(res, 200, { ok: true }); }
    if (method === 'POST' && b === 'reopen') { reopen(); return json(res, 200, { ok: true }); }
    if (method === 'POST' && b === 'start-next') { startNext(); return json(res, 200, { ok: true }); }
    if (method === 'PATCH' && /^\d+$/.test(b || '')) {
      const cy = store.cycle(+b); if (cy.status === 'closed') throw fail(409, 'a closed cycle is a record; it cannot be edited');
      store.saveCycle(+b, { theme: body.theme, start: body.start, end: body.end }); return json(res, 200, store.cycle(+b));
    }
  }
  if (a === 'simulate') {
    if (!String(body.title || body.description || '').trim()) throw fail(400, 'describe the idea first');
    return json(res, 200, analysis.simulate(analysis.analyze(store), body));
  }
  if (a === 'agent' && method === 'POST') {
    const an = analysis.analyze(store); let prompt;
    if (b === 'item') prompt = analysis.itemPrompt(an, body.id);
    else if (b === 'portfolio') prompt = analysis.portfolioPrompt(an);
    else if (b === 'sim') { if (!String(body.title || body.description || '').trim()) throw fail(400, 'describe the idea first'); prompt = analysis.simPrompt(an, body, analysis.simulate(an, body)); }
    if (!prompt) throw fail(404, 'nothing to ask the agent about');
    try { return json(res, 200, { text: await agent.run(prompt) }); } catch (e) { return json(res, 502, { error: `Agent unavailable: ${e.message}` }); }
  }
  if (a === 'projects') {
    if (method === 'POST') return json(res, 201, store.createProject(body));
    if (method === 'PATCH' && b) return json(res, 200, store.updateProject(b, body));
  }
  if (a === 'initiatives') {
    if (method === 'POST' && !b) return json(res, 201, store.createInitiative(body));
    // ids are project/slug, so they take two path segments
    const id = `${b}/${c}`, taskId = parts[4];
    if (b && c) {
      if (method === 'GET' && !d) return json(res, 200, analysis.analyze(store).items.find(i => i.id === id) || (() => { throw fail(404, 'initiative not found'); })());
      if (method === 'PATCH' && !d) return json(res, 200, store.update(id, body));
      if (method === 'DELETE' && !d) { store.remove(id); return json(res, 200, { ok: true }); }
      if (d === 'tasks') {
        if (method === 'POST') return json(res, 201, store.addTask(id, body));
        if (method === 'PATCH' && taskId) return json(res, 200, store.updateTask(id, taskId, body));
        if (method === 'DELETE' && taskId) return json(res, 200, store.removeTask(id, taskId));
      }
      if (d === 'links') {
        if (method === 'POST') return json(res, 201, store.addLink(id, body));
        if (method === 'DELETE') return json(res, 200, store.removeLink(id, url.searchParams.get('url') || ''));
      }
      if (d === 'prs') {
        if (method === 'POST') return json(res, 201, store.addPr(id, body));
        if (method === 'DELETE') return json(res, 200, store.removePr(id, url.searchParams.get('url') || ''));
      }
      if (d === 'log' && method === 'POST') return json(res, 201, store.addLog(id, body));
    }
  }
  return json(res, 404, { error: 'no such endpoint' });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUB, rel);
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // the app routes on the client: any other page path gets the app
    if (!path.extname(rel)) return serveStatic(res, '/');
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'");
  if (publicUrl && req.headers['x-forwarded-proto'] === 'http') { res.writeHead(308, { location: new URL(req.url, publicUrl).href }); return res.end(); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(res, url.pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
  }
});
server.listen(port, host, () => {
  console.log(`Tempo on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${publicUrl ? ` — reached at ${publicUrl}` : ''}`);
  console.log(`vault: ${vault}`);
  if (!fs.existsSync(path.join(PUB, 'vendor', 'editor.js'))) console.log('block editor not built: rich text fields fall back to plain text. Run: npm run build:editor');
  if (!loopbackOnly) console.log(`write token: ${token}${process.env.TEMPO_TOKEN ? ' (from TEMPO_TOKEN)' : ' (generated; set TEMPO_TOKEN to keep one)'}`);
});
module.exports = { server };

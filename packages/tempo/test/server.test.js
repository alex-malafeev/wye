'use strict';
// Spawns the real server over a temp vault, in public mode (token needed to write) and in loopback mode.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function start(args, env) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-srv-')), port = 4500 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--vault', vault, '-p', String(port), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  const ready = new Promise(res => child.stdout.on('data', d => /Tempo on/.test(d) && res()));
  return { child, base, vault, ready, stop: () => child.kill() };
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('public mode: reads are open, writes need the token, webhooks need their signature', async () => {
  const s = start(['--public', 'https://tempo.example.com'], { TEMPO_TOKEN: 'secret', TEMPO_GITHUB_SECRET: 'whsec' });
  await s.ready;
  try {
    assert.strictEqual((await fetch(s.base + '/api/state')).status, 200);
    assert.strictEqual((await post(s.base + '/api/projects', { title: 'P' })).status, 401);
    assert.strictEqual((await post(s.base + '/api/projects', { title: 'P' }, { authorization: 'Bearer wrong' })).status, 401);
    const ok = await post(s.base + '/api/projects', { title: 'P' }, { authorization: 'Bearer secret' });
    assert.strictEqual(ok.status, 201);
    const it = await (await post(s.base + '/api/initiatives', { project: 'p', title: 'Billing' }, { authorization: 'Bearer secret' })).json();
    assert.strictEqual(it.id, 'p/billing');

    const payload = JSON.stringify({ action: 'opened', pull_request: { number: 3, title: 'tempo:p/billing totals', html_url: 'https://github.com/o/r/pull/3' } });
    const sig = 'sha256=' + crypto.createHmac('sha256', 'whsec').update(payload).digest('hex');
    assert.strictEqual((await post(s.base + '/api/ingest/github', payload, { 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=00' })).status, 401);
    assert.strictEqual((await post(s.base + '/api/ingest/github', payload, { 'x-github-event': 'pull_request', 'x-hub-signature-256': sig })).status, 200);
    const got = await (await fetch(s.base + '/api/initiatives/p/billing')).json();
    assert.strictEqual(got.prs.length, 1);

    for (const p of ['/..%2fserver.js', '/../server.js', '/%2e%2e/package.json']) {   // never a file outside public/
      const r = await fetch(s.base + p); assert.ok(!/require\('http'\)|"@wye\/tempo"/.test(await r.text()), p);
    }
    assert.strictEqual((await post(s.base + '/api/projects', 'not json', { authorization: 'Bearer secret' })).status, 400);
  } finally { s.stop(); }
});

test('loopback mode: this machine may write without a token', async () => {
  const s = start([], {});
  await s.ready;
  try { assert.strictEqual((await post(s.base + '/api/projects', { title: 'Local' })).status, 201); } finally { s.stop(); }
});

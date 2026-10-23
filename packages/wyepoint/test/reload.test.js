'use strict';
// Hot reload: a change under public/ reaches an open page; a public server offers none of it.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
function start(args, env = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-reload-')), port = 5000 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--vault', vault, '-p', String(port), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = new Promise(res => child.stdout.on('data', d => /WyePoint on/.test(d) && res()));
  return { child, ready, base: `http://127.0.0.1:${port}` };
}
const touch = f => { const t = new Date(); fs.utimesSync(path.join(PUB, f), t, t); };

test('a change to a page file is pushed to open pages: CSS alone as css, anything else as a reload', async () => {
  const s = start([]); await s.ready;
  try {
    assert.strictEqual((await (await fetch(s.base + '/api/health')).json()).live, true);
    const res = await fetch(s.base + '/__reload'), reader = res.body.getReader(), dec = new TextDecoder();
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    let seen = '';
    const next = async (re, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end && !re.test(seen)) { const r = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ timeout: true }), 300))]); if (r.value) seen += dec.decode(r.value); }
      return re.test(seen);
    };
    assert.ok(await next(/connected/));
    touch('style.css'); assert.ok(await next(/data: css/), seen);
    seen = ''; touch('app.js'); assert.ok(await next(/data: reload/), seen);
    await reader.cancel();
  } finally { s.child.kill(); }
});

test('a server on a public address offers no hot reload', async () => {
  const s = start(['--public', 'https://wyepoint.example.com']); await s.ready;
  try {
    assert.strictEqual((await (await fetch(s.base + '/api/health')).json()).live, false);
    const r = await fetch(s.base + '/__reload'); assert.doesNotMatch(r.headers.get('content-type') || '', /event-stream/);
  } finally { s.child.kill(); }
});

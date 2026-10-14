'use strict';
// The app's server (plan:collaboration, decision:waterfall.collab-sync-is-hocuspocus-beside-next): Next for every
// request, and on one port the websocket the page editors keep their live documents over — next start cannot upgrade
// a request to a websocket.
//   node server.js [-p <port>] [-H <host>] [--dev]
// Behind a TLS proxy (req:waterfall.collaboration.https), WYE_PUBLIC_URL is the https address people reach it at: a
// request that came to the proxy over plain http is sent there. A live page's websocket is taken only from a page of
// this app — its Origin is this address, or the host it was asked of — never from another site in the same browser.
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dev = args.includes('--dev');
if (!dev) process.env.NODE_ENV = 'production';
const http = require('node:http');
const next = require('next');
const port = Number(opt('-p', process.env.PORT || 3000));
const hostname = opt('-H', dev ? 'localhost' : '127.0.0.1');

const publicUrl = process.env.WYE_PUBLIC_URL ? new URL(process.env.WYE_PUBLIC_URL) : null;
const sameOrigin = req => {
  const o = req.headers.origin; if (!o) return true;   // not a browser (a script, the CLI): no page to forge it
  try { const u = new URL(o); return (publicUrl && u.origin === publicUrl.origin) || u.host === req.headers.host; } catch { return false; }
};

const app = next({ dev, dir: process.cwd(), hostname, port });
app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    if (publicUrl && req.headers['x-forwarded-proto'] === 'http') { res.writeHead(308, { location: new URL(req.url || '/', publicUrl).href }); return res.end(); }
    handle(req, res);
  });
  const isCollab = req => (req.url || '').startsWith('/collab');
  // Next adds its own upgrade listener to this server on its first request (the dev server's reload socket) and ends
  // every socket it does not know — a live document's among them. Each listener added after ours skips /collab.
  const on = server.on.bind(server);
  server.on('upgrade', (req, socket, head) => {
    if (!isCollab(req)) return;
    if (!sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n'); return; }
    // set by the app itself when it starts (instrumentation → lib/collab/collab-server), in this process
    const collab = globalThis.__wyeCollab;
    if (collab) collab.upgrade(req, socket, head); else socket.destroy();
  });
  server.on = server.addListener = (ev, fn) => on(ev, ev === 'upgrade' ? (req, socket, head) => { if (!isCollab(req)) fn(req, socket, head); } : fn);
  server.listen(port, hostname, () => console.log(`▲ Wye on http://${hostname}:${port}${dev ? ' (dev)' : ''}${publicUrl ? ` — reached at ${publicUrl.origin}` : ''}`));
}).catch(e => { console.error(e); process.exit(1); });

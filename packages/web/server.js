'use strict';
// The app's server (plan:collaboration, decision:waterfall.collab-sync-is-hocuspocus-beside-next): Next for every
// request, and on one port the websocket the page editors keep their live documents over — next start cannot upgrade
// a request to a websocket.
//   node server.js [-p <port>] [-H <host>] [--dev]
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dev = args.includes('--dev');
if (!dev) process.env.NODE_ENV = 'production';
const http = require('node:http');
const next = require('next');
const port = Number(opt('-p', process.env.PORT || 3000));
const hostname = opt('-H', dev ? 'localhost' : '127.0.0.1');

const app = next({ dev, dir: process.cwd(), hostname, port });
app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => handle(req, res));
  const isCollab = req => (req.url || '').startsWith('/collab');
  // Next adds its own upgrade listener to this server on its first request (the dev server's reload socket) and ends
  // every socket it does not know — a live document's among them. Each listener added after ours skips /collab.
  const on = server.on.bind(server);
  server.on('upgrade', (req, socket, head) => {
    if (!isCollab(req)) return;
    // set by the app itself when it starts (instrumentation → lib/collab/collab-server), in this process
    const collab = globalThis.__wyeCollab;
    if (collab) collab.upgrade(req, socket, head); else socket.destroy();
  });
  server.on = server.addListener = (ev, fn) => on(ev, ev === 'upgrade' ? (req, socket, head) => { if (!isCollab(req)) fn(req, socket, head); } : fn);
  server.listen(port, hostname, () => console.log(`▲ Wye on http://${hostname}:${port}${dev ? ' (dev)' : ''}`));
}).catch(e => { console.error(e); process.exit(1); });

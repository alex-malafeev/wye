'use strict';
// Data pushed in from other systems. One generic shape for anything that can POST JSON, plus a GitHub adapter.
//   { source: "jira", initiative: "project/slug" | "slug", kind: "log" | "link" | "pr" | "status" | "task", ... }
const crypto = require('crypto');

function resolve(store, ref) {
  ref = String(ref || '').trim();
  const all = store.initiatives();
  const hit = all.find(i => i.id === ref) || all.filter(i => i.slug === ref);
  if (Array.isArray(hit)) { if (hit.length === 1) return hit[0]; throw Object.assign(new Error(hit.length ? `"${ref}" is ambiguous, use project/slug` : `no initiative "${ref}"`), { status: hit.length ? 409 : 404 }); }
  return hit;
}

function ingest(store, msg) {
  const source = String(msg.source || 'api').slice(0, 40);
  const it = resolve(store, msg.initiative);
  switch (msg.kind) {
    case 'log': return store.addLog(it.id, { text: msg.text, source });
    case 'link': { const r = store.addLink(it.id, { label: msg.label, url: msg.url, source }); if (msg.text) store.addLog(it.id, { text: msg.text, source }); return r; }
    case 'pr': { const r = store.addPr(it.id, { title: msg.title || msg.label, url: msg.url }); if (msg.text) store.addLog(it.id, { text: msg.text, source }); return r; }
    case 'status': return store.update(it.id, { status: msg.status, source });
    case 'task': {
      const ex = msg.title && it.tasks.find(t => t.title === msg.title);   // pushing the same task again updates it
      if (ex) return store.updateTask(it.id, ex.id, { status: msg.status || ex.status, owner: msg.owner, due: msg.due });
      return store.addTask(it.id, { title: msg.title, owner: msg.owner, due: msg.due, status: msg.status || 'todo' });
    }
    default: throw Object.assign(new Error('kind must be log, link, pr, status or task'), { status: 400 });
  }
}

// A PR or issue names its initiative with `tempo:<project>/<slug>` (or `tempo:<slug>`) in its title, branch or body.
const REF = /tempo[:/]([\w-]+(?:\/[\w-]+)?)/i;
function github(store, event, p) {
  const obj = p.pull_request || p.issue; if (!obj) return { ignored: `${event} carries no pull request or issue` };
  const m = REF.exec([obj.title, obj.head && obj.head.ref, obj.body].filter(Boolean).join('\n'));
  if (!m) return { ignored: 'no tempo:<initiative> reference' };
  const it = resolve(store, m[1]), kind = p.pull_request ? 'PR' : 'Issue';
  const state = obj.merged ? 'merged' : (p.action === 'closed' ? 'closed' : (p.action || 'updated'));
  const label = `${kind} #${obj.number} ${obj.title}`;
  if (p.pull_request) store.addPr(it.id, { title: label, url: obj.html_url }); else store.addLink(it.id, { label, url: obj.html_url, source: 'github' });
  store.addLog(it.id, { text: `${kind} #${obj.number} ${state}: ${obj.title}`, source: 'github' });
  return { initiative: it.id };
}
function verifySignature(secret, raw, header) {
  const want = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(String(header || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { ingest, github, verifySignature, resolve };

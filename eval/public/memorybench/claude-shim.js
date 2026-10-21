'use strict';
// MemoryBench's answering and judge calls through the claude CLI (plan:memorybench, question:waterfall.memorybench.models):
// MemoryBench reaches Anthropic through @ai-sdk/anthropic, which honours ANTHROPIC_BASE_URL — this server answers its
// POST /v1/messages with `claude -p` on the person's own login, so no API key is needed. Each call runs in an empty
// folder with its own system prompt and no tools or MCP servers: the prompt is MemoryBench's and nothing else.
//   node claude-shim.js [--port 3471] [--parallel 6] [--log calls.jsonl]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function arg(name, dflt) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; }
const PORT = Number(arg('port', process.env.WYE_BENCH_SHIM_PORT || 3471));
const PARALLEL = Number(arg('parallel', process.env.WYE_BENCH_PARALLEL || 6));
const LOG = arg('log', null);
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'wye-bench-claude-'));

let running = 0; const queue = [];
const slot = () => new Promise(r => { if (running < PARALLEL) { running++; r(); } else queue.push(r); });
const release = () => { const n = queue.shift(); if (n) n(); else running--; };

const textOf = c => typeof c === 'string' ? c : (c || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

function claude(model, system, prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config', '--system-prompt', system || 'You are a careful assistant. Follow the instructions in the message exactly.'];
    const child = spawn('claude', args, { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', code => {
      clearTimeout(t);
      try { const j = JSON.parse(out); if (j.is_error) throw new Error(j.result || 'error'); resolve(j); }
      catch (e) { reject(new Error(`claude exited ${code}: ${(err || out || e.message).slice(0, 300)}`)); }
    });
    child.stdin.end(prompt);
  });
}

async function call(body) {
  const system = textOf(body.system);
  const prompt = (body.messages || []).map(m => (body.messages.length > 1 ? `${m.role.toUpperCase()}:\n` : '') + textOf(m.content)).join('\n\n');
  await slot();
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const j = await claude(body.model, system, prompt);
        const model = Object.keys(j.modelUsage || {})[0] || body.model;
        if (LOG) fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), asked: body.model, model, ms: Date.now() - t0, in: j.usage && j.usage.input_tokens, out: j.usage && j.usage.output_tokens }) + '\n');
        return { id: 'msg_' + j.session_id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: String(j.result || '') }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: (j.usage && j.usage.input_tokens) || 0, output_tokens: (j.usage && j.usage.output_tokens) || 0 } };
      } catch (e) { if (attempt >= 3) throw e; await new Promise(r => setTimeout(r, 2000 * attempt)); }
    }
  } finally { release(); }
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || !/\/messages$/.test(req.url)) { res.writeHead(404); return res.end(); }
  let raw = ''; req.on('data', d => raw += d);
  req.on('end', async () => {
    try { const r = await call(JSON.parse(raw)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)); }
    catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: e.message } })); }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`claude shim on http://127.0.0.1:${PORT}/v1 — ${PARALLEL} at a time`));

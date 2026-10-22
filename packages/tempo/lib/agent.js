'use strict';
// The status agents run through Claude Code, the way Wye runs its own agents: `claude -p`, the prompt on stdin, no
// tools, no session kept, from an empty folder so it reads nothing of this machine. TEMPO_AGENT_CMD swaps the command
// (it receives the prompt on stdin and prints the answer); TEMPO_AGENT_MODEL picks the model (default sonnet).
const { spawn } = require('child_process');
const os = require('os');

function run(prompt, { timeout = 120000 } = {}) {
  const custom = process.env.TEMPO_AGENT_CMD;
  const [cmd, ...args] = custom ? custom.split(/\s+/).filter(Boolean) : ['claude', '-p', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--model', process.env.TEMPO_AGENT_MODEL || 'sonnet'];
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const finish = (f, v) => { if (!done) { done = true; clearTimeout(timer); f(v); } };
    let child;
    try { child = spawn(cmd, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error('the agent took too long')); }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish(reject, new Error(e.code === 'ENOENT' ? `${cmd} is not installed on this server` : e.message)));
    child.on('close', code => code === 0 && out.trim() ? finish(resolve, out.trim()) : finish(reject, new Error((err.trim() || `the agent exited with ${code}`).slice(0, 300))));
    child.stdin.on('error', () => { /* the process ended before reading the prompt */ });
    child.stdin.end(prompt);
  });
}
module.exports = { run };

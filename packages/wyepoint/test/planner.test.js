'use strict';
// The planner's own logic: tiers, checks, progress, load, the plan checks, the simulation, and the full cycle flow
// (plan → release → start next → snapshot and carry-over) through the real server.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const analysis = require('../lib/analysis');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyepoint-pl-'));
const day = off => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);

function fixture() {
  const s = new Store(tmp()); s.setConfig({ start: day(-14) });
  s.createProject({ title: 'Web' });
  const mk = (title, o) => s.createInitiative({ project: 'web', title, ...o });
  mk('Late one', { owner: 'Dana', contributors: 'Lee', status: 'on-track', cycle: 0, rank: 1, approved: true, target: day(-3), ships: 'x', effort: 'M' });
  mk('Bare', { cycle: 0, rank: 2, approved: true });
  const done = mk('Shipped', { owner: 'Lee', status: 'complete', cycle: 0, rank: 3, approved: true, target: day(5), ships: 'y', effort: 'S' });
  s.addTask(done.id, { title: 'a', status: 'done' }); s.addTask(done.id, { title: 'b', status: 'in-progress' });
  mk('Waiting', { owner: 'Dana', bucket: 'next', approved: true, effort: 'XL' });
  mk('Planned', { owner: 'Sam', cycle: 1, rank: 1, approved: true, effort: 'XL' });
  return s;
}

test('tiers, planner checks and progress', () => {
  const a = analysis.analyze(fixture()), by = t => a.items.find(i => i.title === t);
  assert.strictEqual(a.ctx.active, 0);
  assert.deepStrictEqual(['Late one', 'Bare', 'Shipped', 'Waiting', 'Planned'].map(t => by(t).tier), ['cycle', 'cycle', 'cycle', 'next', 'plan']);
  assert.ok(by('Late one').flags.some(f => /has passed/.test(f)));
  assert.deepStrictEqual(by('Bare').flags.slice(0, 3), ['No named champion', 'No status set', 'No target ship date']);
  assert.strictEqual(by('Waiting').flags.length, 0);          // checks only run on the active cycle
  assert.strictEqual(by('Shipped').progress, 75);             // one milestone done, one half-done
  assert.strictEqual(by('Bare').statusLabel, 'No status');
  assert.strictEqual(by('Waiting').statusLabel, 'Backlog');
});

test('people: load counts champion x2 and contributor x1 on unshipped cycle items', () => {
  const s = fixture(); s.createPerson({ name: 'Zed', role: 'Intern' }); s.createPerson({ name: 'dana', role: 'Manager', team: 'Web' });
  const a = analysis.analyze(s), p = n => a.people.find(x => x.n === n);
  assert.strictEqual(p('dana').load.score, 2);                // Late one; Waiting is not in the cycle
  assert.strictEqual(p('Lee').load.score, 1);                 // contributor on Late one; Shipped is shipped
  assert.deepStrictEqual([p('Zed').tag, p('Zed').inDirectory, p('Zed').role], ['Has room', true, 'Intern']);
  assert.strictEqual(a.people.filter(x => x.n.toLowerCase() === 'dana').length, 1);   // a name on initiatives and in the directory is one person
  assert.deepStrictEqual([p('dana').role, p('dana').team, p('dana').inDirectory], ['Manager', 'Web', true]);
  assert.strictEqual(p('Lee').inDirectory, false);                                        // named on an initiative, not added yet
});

test('plan checks: one XL with company, no champion, unapproved', () => {
  const s = fixture(); const a0 = analysis.analyze(s);
  for (const t of ['Late one', 'Bare', 'Shipped']) { const i = a0.items.find(x => x.title === t); s.update(i.id, { cycle: 1, rank: 9 }); }
  s.update(a0.items.find(x => x.title === 'Bare').id, { approved: false });
  const a = analysis.analyze(s);
  assert.ok(a.checks.some(c => /XL item plus 3 or more/.test(c)));
  assert.ok(a.checks.some(c => /no champion/.test(c)));
  assert.ok(a.checks.some(c => /no longer approved/.test(c)));
  assert.strictEqual(a.canRelease, false);
});

test('simulate finds the related initiative and its people', () => {
  const a = analysis.analyze(fixture()), r = analysis.simulate(a, { title: 'late one export', description: '' });
  assert.ok(r.items.some(id => id.endsWith('/late-one')));
  assert.strictEqual(r.people[0].n, 'Dana');
  assert.ok(analysis.itemPrompt(a, r.items[0]).includes('Late one'));
  assert.ok(analysis.portfolioPrompt(a).includes('Director'));
});

function serve(vault, env) {
  const port = 4900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--vault', vault, '-p', String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = new Promise(res => child.stdout.on('data', d => /WyePoint on/.test(d) && res()));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body) => { const r = await fetch(base + '/api' + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return { child, ready, call };
}

test('cycle flow through the server: release rules, start next, snapshot, carry-over, agents', async () => {
  const vault = tmp(), s = fixture(); fs.cpSync(s.dir, vault, { recursive: true });
  // a stub agent: echoes the first 40 characters of the prompt, so no model is called
  const srv = serve(vault, { WYEPOINT_AGENT_CMD: 'head -c 40' }); await srv.ready;
  try {
    let st = (await srv.call('GET', '/state')).body;
    assert.strictEqual(st.active, 0); assert.strictEqual(st.nx, 1);
    assert.strictEqual((await srv.call('POST', '/cycles/start-next')).status, 409);           // not released yet
    assert.strictEqual((await srv.call('PATCH', '/initiatives/web/planned', { approved: false })).status, 200);
    assert.strictEqual((await srv.call('POST', '/cycles/release')).status, 409);              // an unapproved item blocks it
    await srv.call('PATCH', '/initiatives/web/planned', { approved: true });
    assert.strictEqual((await srv.call('POST', '/cycles/release')).status, 200);
    assert.strictEqual((await srv.call('PATCH', '/cycles/1', { theme: 'Late' })).status, 200);
    st = (await srv.call('GET', '/state')).body; assert.strictEqual(st.cycles[1].status, 'released'); assert.strictEqual(st.cycles[1].theme, 'Late');
    assert.strictEqual((await srv.call('POST', '/cycles/reopen')).status, 200);
    await srv.call('POST', '/cycles/release');

    assert.strictEqual((await srv.call('POST', '/cycles/start-next')).status, 200);
    st = (await srv.call('GET', '/state')).body;
    assert.deepStrictEqual([st.active, st.nx, st.cycles[0].status, st.cycles[1].status], [1, 2, 'closed', 'active']);
    assert.strictEqual(st.cycles[0].snapshot, true); assert.strictEqual(st.cycles[0].rows.length, 3); assert.strictEqual(st.cycles[0].shipped, 1);
    const late = st.initiatives.find(i => i.title === 'Late one'), shipped = st.initiatives.find(i => i.title === 'Shipped');
    assert.strictEqual(late.tier, 'carry'); assert.strictEqual(shipped.tier, 'done');
    assert.ok(late.log[0].text.includes('carried over'));
    assert.strictEqual((await srv.call('PATCH', '/cycles/0', { theme: 'x' })).status, 409);   // closed is a record

    assert.strictEqual((await srv.call('POST', '/simulate', { title: 'late one' })).status, 200);
    const ag = await srv.call('POST', '/agent/portfolio', {}); assert.strictEqual(ag.status, 200); assert.match(ag.body.text, /portfolio status agent/);
    assert.strictEqual((await srv.call('POST', '/agent/item', { id: 'web/nope' })).status, 404);
    const ann = await srv.call('POST', '/people', { name: 'Ann', role: 'Designer', team: 'Web', email: 'ann@example.com' });
    assert.strictEqual(ann.status, 201); assert.strictEqual(ann.body.source, 'manual');
    assert.strictEqual((await srv.call('POST', '/people', { name: 'ann' })).status, 409);          // already there, whatever the case
    assert.strictEqual((await srv.call('POST', '/people', { name: 'Bo', email: 'nope' })).status, 400);
    assert.strictEqual((await srv.call('PATCH', '/people/ann', { role: 'Lead designer' })).body.role, 'Lead designer');
    st = (await srv.call('GET', '/state')).body; assert.ok(st.people.find(p => p.n === 'Ann' && p.role === 'Lead designer' && p.tag === 'Has room'));
    assert.strictEqual((await srv.call('DELETE', '/people/ann')).status, 200);
    assert.ok(!(await srv.call('GET', '/state')).body.people.some(p => p.n === 'Ann'));
  } finally { srv.child.kill(); }
});

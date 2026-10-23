// "Simulate" on an initiative that is being planned: who it would pull in, what it touches, who gets stretched, and a
// briefing from the agent. The deterministic part comes back at once; the briefing follows.
import { S, h, chip, muted, api, render, openPerson, openIt, items } from './core.js';
import { smallRow, list } from './views.js';

// initiatives in the plan or waiting in the pool can be simulated; those already running, or shipped, cannot
export const canSimulate = i => !['cycle', 'done'].includes(i.tier);

export async function openSimulation(it) {
  const run = S.sim = { id: it.id, title: it.title, result: null, text: 'Thinking…', err: '' };
  render();
  const input = { title: it.title, description: it.ships || it.description, effort: it.effort || 'M', when: it.tier === 'plan' ? 'cycle3' : 'later', exclude: it.id };
  try { run.result = await api('POST', '/simulate', input); } catch (e) { run.err = e.message; run.text = ''; if (S.sim === run) render(); return; }
  if (S.sim === run) render();
  try { run.text = (await api('POST', '/agent/sim', input)).text; } catch (e) { run.text = e.message; }
  if (S.sim === run) render();
}

export function simulateModal() {
  const s = S.sim; if (!s) return null;
  const byId = Object.fromEntries(items().map(i => [i.id, i]));
  const close = () => { S.sim = null; render(); };
  const r = s.result;
  return h('div', { class: 'modal', onClick: e => { if (e.target === e.currentTarget) close(); } }, h('div', { class: 'card sim-card' },
    h('div', { class: 'hrow between', style: 'flex-wrap:nowrap;align-items:flex-start' }, h('div', {}, h('div', { class: 'lbl' }, 'Simulation'), h('h3', {}, s.title)), h('button', { class: 'btn sm', onClick: close }, 'Close')),
    muted('What starting this now would touch: the people closest to it, the projects it overlaps with, and who gets stretched.', 'small'),
    s.err ? h('div', { class: 'err' }, s.err) : null,
    r ? [
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Most relevant people'),
        list(r.people.map(p => h('button', { class: 'row', onClick: () => { S.sim = null; openPerson(p.n); } }, h('div', { style: 'flex:1 1 auto;min-width:0' }, h('div', { style: 'font-weight:600' }, p.n), h('div', { class: 'muted small' }, p.why)), chip(p.tagClass, `${p.tag} (${p.active} active)`)))),
        r.people.length ? null : muted('Nobody on the plan looks close to this.', 'small')),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Related and affected projects'),
        list(r.items.map(id => byId[id]).filter(Boolean).map(i => smallRow(i, '', () => { S.sim = null; openIt(i.id); }))), r.items.length ? null : muted('No related projects found.', 'small')),
      h('div', { class: 'stack' }, h('div', { class: 'lbl' }, 'Simulation agent'), h('div', { class: 'agent' }, s.text)),
    ] : (s.err ? null : h('div', { class: 'muted' }, 'Working it out…'))));
}

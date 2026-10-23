// The page shell: the header, the tabs, the active view, the detail drawer and the dialogs.
import { S, TABS, h, muted, load, route, go, render, setRenderer, cyc, items, range } from './core.js';
import { overview, projects, backlog, people, simulate, portfolioCard, runPortfolio } from './views.js';
import { plan, history, settings } from './plan.js';
import { drawer, modal } from './drawer.js';
import { inEditor, prune } from './rich.js';

const VIEWS = { overview, projects, backlog, people, sim: simulate, plan, history, settings };
const app = document.getElementById('app');

// While someone types in a rich text field the page is not rebuilt under them (the save that follows would drop their
// cursor); it is redrawn when they leave the field.
let pending = false, poll = 0;
function draw() {
  // focusout is the quick way back to a redraw; the poll is the sure one (a blur the browser does not announce)
  if (S.data && inEditor(document.activeElement) && app.contains(document.activeElement)) {
    pending = true;
    if (!poll) poll = setInterval(() => { if (!inEditor(document.activeElement)) draw(); }, 300);
    return;
  }
  pending = false; clearInterval(poll); poll = 0;
  if (!S.data) { app.replaceChildren(h('div', { class: 'wrap muted' }, S.err || 'Loading…')); return; }
  const { view, open } = route(), d = S.data, A = cyc(d.active);
  if (!open) prune(k => k.startsWith('modal:'));
  // a re-render replaces the DOM: keep the drawer's scroll and the field the person is typing in
  const old = app.querySelector('.drawer'), scroll = old ? old.scrollTop : 0, a = document.activeElement, key = a && a.dataset && a.dataset.k, pos = a && a.selectionStart;
  const cy = items().filter(i => i.tier === 'cycle');
  document.title = `${d.config.title} · planner`;
  app.replaceChildren(...[
    h('div', { class: 'top' }, h('div', { class: 'wrap' },
      h('div', {}, h('div', { style: 'font-size:20px;font-weight:700' }, d.config.title), h('div', { class: 'muted', style: 'font-size:13px' }, `${A.name} · ${range(A)}${A.theme ? ' · ' + A.theme : ''} · ${cy.length} ranked items / ${items().length} total`)),
      h('nav', { class: 'hrow' }, TABS.filter(t => t[0] !== 'settings').map(([k, l]) => h('button', { class: 'btn' + (k === view ? ' on' : ''), onClick: () => go(k) }, l)),
        h('button', { class: 'btn' + (view === 'settings' ? ' on' : ''), onClick: () => go('settings') }, 'Settings'),
        h('button', { class: 'btn', onClick: () => { S.modal = d.projects.length ? { kind: 'initiative', project: d.projects[0].slug } : { kind: 'project' }; S.err = ''; render(); } }, 'New initiative'),
        h('button', { class: 'btn pri', onClick: runPortfolio }, 'Status agent')))),
    h('div', { class: 'wrap main' }, portfolioCard(), S.err && !open && !S.modal && view !== 'plan' && view !== 'settings' && view !== 'sim' ? h('div', { class: 'err' }, S.err) : null, VIEWS[view](),
      muted(`Stored in a Wye vault: every initiative is a Markdown page. Cycles are ${d.config.weeks} weeks${d.config.cooldown ? ` plus ${d.config.cooldown} days cooldown` : ''}.`, 'small')),
    open ? drawer(open) : null, modal(),
  ].filter(Boolean));
  const dr = app.querySelector('.drawer'); if (dr) dr.scrollTop = scroll;
  if (key) { const el = app.querySelector(`[data-k="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* selects have no range */ } } }
}

setRenderer(draw);
app.addEventListener('focusout', () => setTimeout(() => { if (pending && !inEditor(document.activeElement)) draw(); }, 50));
window.addEventListener('hashchange', () => { S.err = ''; draw(); });
load().catch(e => { S.err = e.message; draw(); });

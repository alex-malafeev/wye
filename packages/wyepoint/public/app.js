// The page shell: the header, the page title, the active view, the detail drawers and the dialogs.
import { S, TABS, h, muted, load, route, go, render, setRenderer, cyc, items, range, fmtDate } from './core.js';
import { overview, projects, backlog, people, portfolioCard, runPortfolio } from './views.js';
import { plan, history, settings } from './plan.js';
import { drawer, modal } from './drawer.js';
import { projectDrawer } from './project.js';
import { fullView } from './full.js';
import { personDrawer } from './person.js';
import { simulateModal } from './simulate.js';
import { inEditor, prune } from './rich.js';

const VIEWS = { overview, projects, backlog, people, plan, history, settings };
const app = document.getElementById('app');

// what each page is for, under its title
function subtitle(view, d, A) {
  const nx = cyc(d.nx);
  return {
    overview: `${A.name} · ${range(A)}${A.theme ? ' · ' + A.theme : ''}`,
    projects: 'Every initiative, grouped by project. Open a project to edit its page, details and links.',
    backlog: `${items().length} initiatives. Filter, group and sort them any way you like.`,
    people: 'Who is carrying what in the active cycle, and who has room.',
    plan: `${nx.name} · ${range(nx)}. Pick from the pool, rank, check and release.`,
    history: 'Every cycle. A closed one shows the snapshot taken when it closed.',
    settings: 'The workspace, its cycles, and how other systems push data in.',
  }[view];
}

// where we are in the active cycle: "Week 2 of 6" and how far through it is
function cycleProgress(d, A) {
  const start = new Date(A.start + 'T00:00:00Z'), end = new Date(A.end + 'T00:00:00Z'), today = new Date(d.today + 'T00:00:00Z');
  const total = (end - start) / 864e5 + 1, el = Math.max(0, Math.min(total, (today - start) / 864e5 + 1));
  return { pct: Math.round(el / total * 100), week: Math.min(d.config.weeks, Math.max(1, Math.ceil(el / 7))) };
}

// a new initiative goes in the first project; with no project yet, the dialog starts with a project
const newInitiative = d => () => { const p = d.projects[0]; S.modal = p ? { kind: 'initiative', project: p.slug } : { kind: 'project' }; S.err = ''; render(); };

// where the cycle is: shown on the overview only
function cyclePill(d, A) {
  const cp = cycleProgress(d, A);
  return h('div', { class: 'cycle-pill', title: `${A.name}: ${range(A)}` }, h('span', {}, h('b', {}, A.name), ` · week ${cp.week} of ${d.config.weeks}`), h('span', { class: 'cycle-bar' }, h('i', { style: `width:${cp.pct}%` })));
}

// the settings icon: an SVG built as markup (h() makes HTML elements)
const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/></svg>';
function gear() { const s = document.createElement('span'); s.style.display = 'inline-flex'; s.innerHTML = GEAR; return s; }

function header(view, d, A) {
  return h('header', { class: 'top' }, h('div', { class: 'wrap topbar' },
    h('a', { class: 'brand', href: '#/overview', 'aria-label': 'WyePoint home' }, h('img', { class: 'brand-logo', src: '/wyepoint-logo.svg', alt: d.config.title })),
    h('nav', { class: 'tabs', 'aria-label': 'Pages' }, TABS.filter(t => t[0] !== 'settings').map(([k, l]) => h('button', { class: 'tab' + (k === view ? ' on' : ''), 'aria-current': k === view ? 'page' : null, onClick: () => go(k) }, l))),
    h('div', { class: 'top-right' },
      h('button', { class: 'btn', onClick: runPortfolio }, '✦ Status agent'),
      h('button', { class: 'icon-btn' + (view === 'settings' ? ' on' : ''), title: 'Settings', 'aria-label': 'Settings', 'aria-current': view === 'settings' ? 'page' : null, onClick: () => go('settings') },
        gear()))));
}

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
  const { view, open, project, person, full } = route(), d = S.data, A = cyc(d.active), isFull = view === 'full';
  if (!open && !project && !person && !isFull) prune(k => k.startsWith('modal:'));
  // a re-render replaces the DOM: keep the drawer's scroll and the field the person is typing in
  const old = app.querySelector('.drawer'), scroll = old ? old.scrollTop : 0, a = document.activeElement, key = a && a.dataset && a.dataset.k, pos = a && a.selectionStart;
  document.title = `${d.config.title} · ${isFull ? 'Full view' : TABS.find(t => t[0] === view)[1]}`;
  app.replaceChildren(...[
    header(view, d, A),
    isFull ? fullView(full) : h('main', { class: 'wrap' }, h('div', { class: 'panel' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, TABS.find(t => t[0] === view)[1]), h('div', { class: 'muted' }, subtitle(view, d, A))),
        view === 'projects' ? h('button', { class: 'btn pri', onClick: newInitiative(d) }, '+ New initiative') : view === 'overview' ? cyclePill(d, A) : null),
      h('div', { class: 'main' }, portfolioCard(), S.err && !open && !project && !person && !S.modal && !['plan', 'settings'].includes(view) ? h('div', { class: 'err' }, S.err) : null, VIEWS[view](),
        muted(`Stored in a Wye vault: every initiative and project is a Markdown page. Cycles are ${d.config.weeks} weeks${d.config.cooldown ? ` plus ${d.config.cooldown} days cooldown` : ''}.`, 'small')))),
    !isFull && open ? drawer(open) : !isFull && project ? projectDrawer(project) : !isFull && person ? personDrawer(person) : null, modal(), simulateModal(),
  ].filter(Boolean));
  const dr = app.querySelector('.drawer'); if (dr) dr.scrollTop = scroll;
  if (key) { const el = app.querySelector(`[data-k="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* selects have no range */ } } }
}

setRenderer(draw);
app.addEventListener('focusout', () => setTimeout(() => { if (pending && !inEditor(document.activeElement)) draw(); }, 50));
window.addEventListener('hashchange', () => { S.err = ''; draw(); });
load().catch(e => { S.err = e.message; draw(); });

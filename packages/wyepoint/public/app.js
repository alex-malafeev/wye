// The page shell: the header, the page title, the active view, the detail drawers and the dialogs.
import { S, TABS, h, muted, load, route, go, render, setRenderer, cyc, items, range, fmtDate } from './core.js';
import { overview, projects, backlog, people, portfolioCard, runPortfolio } from './views.js';
import { plan, history, settings } from './plan.js';
import { drawer, modal } from './drawer.js';
import { projectDrawer } from './project.js';
import { simulateModal } from './simulate.js';
import { inEditor, prune } from './rich.js';

const VIEWS = { overview, projects, backlog, people, plan, history, settings };
const app = document.getElementById('app');

// what each page is for, under its title
function subtitle(view, d, A) {
  const nx = cyc(d.nx);
  return {
    overview: `${A.name} · ${range(A)}${A.theme ? ' · ' + A.theme : ''}`,
    projects: 'Initiatives grouped by project. Open a project to edit its page, details and links.',
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

function header(view, d, A) {
  const cp = cycleProgress(d, A);
  const search = h('input', { class: 'search', type: 'search', 'data-k': 'gsearch', placeholder: 'Search', 'aria-label': 'Search initiatives', value: S.f.q,
    onKeyDown: e => { if (e.key === 'Enter') { S.f.q = e.target.value; go('backlog'); e.target.blur(); } } });
  return h('header', { class: 'top' }, h('div', { class: 'wrap topbar' },
    h('a', { class: 'brand', href: '#/overview', 'aria-label': 'WyePoint home' }, h('img', { class: 'brand-logo', src: '/wyepoint-logo.svg', alt: d.config.title })),
    h('nav', { class: 'tabs', 'aria-label': 'Pages' }, TABS.map(([k, l]) => h('button', { class: 'tab' + (k === view ? ' on' : ''), 'aria-current': k === view ? 'page' : null, onClick: () => go(k) }, l))),
    h('div', { class: 'top-right' },
      h('div', { class: 'cycle-pill', title: `${A.name}: ${range(A)}` }, h('span', {}, h('b', {}, A.name), ` · week ${cp.week} of ${d.config.weeks}`), h('span', { class: 'cycle-bar' }, h('i', { style: `width:${cp.pct}%` }))),
      h('button', { class: 'btn', onClick: runPortfolio }, '✦ Status agent'),
      h('button', { class: 'btn pri', onClick: () => { const p = d.projects[0]; S.modal = p ? { kind: 'initiative', project: p.slug } : { kind: 'project' }; S.err = ''; render(); } }, '+ New initiative'),
      h('div', { class: 'search-wrap' }, search, h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, '/')))));
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
  const { view, open, project } = route(), d = S.data, A = cyc(d.active);
  if (!open && !project) prune(k => k.startsWith('modal:'));
  // a re-render replaces the DOM: keep the drawer's scroll and the field the person is typing in
  const old = app.querySelector('.drawer'), scroll = old ? old.scrollTop : 0, a = document.activeElement, key = a && a.dataset && a.dataset.k, pos = a && a.selectionStart;
  document.title = `${d.config.title} · ${TABS.find(t => t[0] === view)[1]}`;
  app.replaceChildren(...[
    header(view, d, A),
    h('main', { class: 'wrap' }, h('div', { class: 'panel' },
      h('div', { class: 'page-head' }, h('h1', {}, TABS.find(t => t[0] === view)[1]), h('div', { class: 'muted' }, subtitle(view, d, A))),
      h('div', { class: 'main' }, portfolioCard(), S.err && !open && !project && !S.modal && !['plan', 'settings'].includes(view) ? h('div', { class: 'err' }, S.err) : null, VIEWS[view](),
        muted(`Stored in a Wye vault: every initiative and project is a Markdown page. Cycles are ${d.config.weeks} weeks${d.config.cooldown ? ` plus ${d.config.cooldown} days cooldown` : ''}.`, 'small')))),
    open ? drawer(open) : project ? projectDrawer(project) : null, modal(), simulateModal(),
  ].filter(Boolean));
  const dr = app.querySelector('.drawer'); if (dr) dr.scrollTop = scroll;
  if (key) { const el = app.querySelector(`[data-k="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* selects have no range */ } } }
}

setRenderer(draw);
app.addEventListener('focusout', () => setTimeout(() => { if (pending && !inEditor(document.activeElement)) draw(); }, 50));
window.addEventListener('hashchange', () => { S.err = ''; draw(); });
// "/" jumps to the search box, as it does in Perch
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const el = app.querySelector('[data-k="gsearch"]'); if (el) { e.preventDefault(); el.focus(); }
});
load().catch(e => { S.err = e.message; draw(); });

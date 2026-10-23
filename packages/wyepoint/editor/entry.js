// The Notion-style editor WyePoint uses for a page — BlockNote, the library Wye's own document editor is built on. The
// page is one document: prose as ordinary blocks, and blocks for what a planner keeps — milestones, links, pull requests,
// updates, instances of the types a person has defined (a risk, a decision …) and drawings (Excalidraw) — inserted
// anywhere with "/". Markdown goes in and comes out, in the line formats of lib/lines.js, so the vault keeps plain
// Markdown that Wye reads. Built by `npm run build:editor` into public/vendor/ and loaded on demand.
import { createElement as e, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { useCreateBlockNote, createReactBlockSpec, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import L from '../lib/lines.js';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './blocks.css';

const SAVE_AFTER = 700;   // ms of quiet before a change is handed back
const STATUSES = [['todo', 'Not started'], ['in-progress', 'In progress'], ['review', 'In review'], ['blocked', 'Blocked'], ['done', 'Done']];
const stamp = () => new Date().toISOString().slice(0, 16) + 'Z';
const today = () => new Date().toISOString().slice(0, 10);

// what the editor is told about its page: the types a person defined, the people, where the page lives
let CTX = { types: [], people: [], scope: 'new', project: '' };
const typeOf = k => CTX.types.find(t => t.slug === k);
const nextTid = (editor, kind) => { let n = 0; for (const b of editor.document) if (b.type === 'typed' && b.props.kind === kind) n = Math.max(n, +(/\.(\d+)$/.exec(b.props.tid) || [0, 0])[1]); return `${CTX.scope}.${n + 1}`; };

// a field on a block: committed when it loses focus or on Enter, so typing in it never re-renders the block
const field = (cls, value, placeholder, commit, label, type = 'text') => e('input', {
  className: cls, type, defaultValue: value, placeholder, 'aria-label': label, contentEditable: false, spellCheck: false,
  onBlur: ev => { if (ev.target.value !== value) commit(ev.target.value); }, onKeyDown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } },
});

const Milestone = createReactBlockSpec(
  { type: 'milestone', propSchema: { mid: { default: '' }, status: { default: 'todo' }, owner: { default: '' }, due: { default: '' } }, content: 'inline' },
  { render: ({ block, editor, contentRef }) => {
    const p = block.props, set = patch => editor.updateBlock(block, { props: patch });
    return e('div', { className: `tb tb-milestone st-${p.status}` },
      e('select', { className: 'tb-status', value: p.status, contentEditable: false, 'aria-label': 'Milestone status', onChange: ev => set({ status: ev.target.value }) }, STATUSES.map(([v, l]) => e('option', { key: v, value: v }, l))),
      e('div', { className: 'tb-title', ref: contentRef }),
      field('tb-small', p.owner, 'owner', v => set({ owner: v }), 'Owner'),
      field('tb-small tb-date', p.due, 'due YYYY-MM-DD', v => set({ due: v }), 'Due date'));
  } },
);
const Ref = createReactBlockSpec(
  { type: 'ref', propSchema: { kind: { default: 'link' }, url: { default: '' }, meta: { default: '' } }, content: 'inline' },
  { render: ({ block, editor, contentRef }) => {
    const p = block.props, set = patch => editor.updateBlock(block, { props: patch });
    return e('div', { className: `tb tb-ref kind-${p.kind}` },
      e('span', { className: 'tb-tag', contentEditable: false }, p.kind === 'pr' ? 'PR' : 'Link'),
      e('div', { className: 'tb-title', ref: contentRef }),
      field('tb-url', p.url, 'https://…', v => set({ url: v.trim() }), 'URL'),
      /^https?:\/\/./i.test(p.url) ? e('a', { className: 'tb-open', href: p.url, target: '_blank', rel: 'noopener noreferrer', contentEditable: false }, 'open ↗') : null);
  } },
);
const Update = createReactBlockSpec(
  { type: 'update', propSchema: { ts: { default: '' }, source: { default: 'manual' } }, content: 'inline' },
  { render: ({ block, contentRef }) => e('div', { className: 'tb tb-update' },
    e('span', { className: 'tb-when', contentEditable: false }, block.props.ts.replace('T', ' ').replace('Z', ''), ' · ', e('b', {}, block.props.source)),
    e('div', { className: 'tb-title', ref: contentRef })) },
);

// ---- an instance of a type a person defined: its text, its status, and the fields the type declares
const control = (f, value, commit) => {
  const key = `${f.name}:${value}`;
  if (f.kind === 'bool') return e('input', { key, type: 'checkbox', checked: value === 'true', 'aria-label': f.name, contentEditable: false, onChange: ev => commit(ev.target.checked ? 'true' : '') });
  if (f.kind === 'choice') return e('select', { key, value, 'aria-label': f.name, contentEditable: false, onChange: ev => commit(ev.target.value) }, [e('option', { key: '', value: '' }, '–'), ...f.options.map(o => e('option', { key: o, value: o }, o))]);
  if (f.kind === 'person') return e('select', { key, value, 'aria-label': f.name, contentEditable: false, onChange: ev => commit(ev.target.value) }, [e('option', { key: '', value: '' }, '–'), ...CTX.people.map(p => e('option', { key: p.slug, value: `person:${p.slug}` }, p.name))]);
  return field('tb-fval', value, '–', commit, f.name, f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text');
};
const Typed = createReactBlockSpec(
  { type: 'typed', propSchema: { kind: { default: '' }, tid: { default: '' }, status: { default: '' }, data: { default: '{}' } }, content: 'inline' },
  { render: ({ block, editor, contentRef }) => {
    const p = block.props, t = typeOf(p.kind);
    let data = {}; try { data = JSON.parse(p.data); } catch { /* an empty block */ }
    const setData = (k, v) => editor.updateBlock(block, { props: { data: JSON.stringify({ ...data, [k]: v }) } });
    if (!t) return e('div', { className: 'tb tb-typed' }, e('span', { className: 'tb-tag', contentEditable: false }, p.kind), e('div', { className: 'tb-title', ref: contentRef }));   // its type was removed
    return e('div', { className: 'tb tb-typed' },
      e('div', { className: 'tb-typed-head' },
        e('span', { className: 'tb-tag tb-kind', contentEditable: false, title: t.purpose }, t.name),
        t.statuses.length ? e('select', { className: 'tb-status-sel', value: p.status, contentEditable: false, 'aria-label': 'Status', onChange: ev => editor.updateBlock(block, { props: { status: ev.target.value } }) }, t.statuses.map(s => e('option', { key: s, value: s }, s))) : null,
        e('div', { className: 'tb-title', ref: contentRef })),
      t.fields.length ? e('div', { className: 'tb-fields', contentEditable: false }, t.fields.map(f => e('label', { key: f.name, className: 'tb-field' }, e('span', {}, f.name.replace(/-/g, ' ')), control(f, data[f.name] || '', v => setData(f.name, v))))) : null);
  } },
);

// ---- a drawing: Excalidraw, opened full-screen on demand (and only then loaded). The page holds an image link, as Wye
// writes one; the scene, its SVG and PNG preview and a text description are files the server keeps beside the page.
const slugOf = src => src.replace(/^.*\//, '').replace(/\.excalidraw$/, '');
const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
async function put(url, body, retry = true) {
  const token = localStorage.getItem('wyepoint_token') || '';
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  if (r.status === 401 && retry) { const t = window.prompt('This server needs its write token to save changes:'); if (t) { localStorage.setItem('wyepoint_token', t.trim()); return put(url, body, false); } }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `could not save (${r.status})`);
}
function DrawEditor({ base, title, onClose }) {
  const [mod, setMod] = useState(null), [scene, setScene] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), api = useRef(null);
  useEffect(() => {
    window.EXCALIDRAW_ASSET_PATH = '/vendor/excalidraw/';             // its fonts, served from here rather than a CDN
    Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')]).then(([m]) => setMod(m)).catch(x => setErr('The drawing board could not load: ' + x.message));
    fetch(base + '.excalidraw').then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(setScene);
  }, []);
  useEffect(() => { const k = ev => { if (ev.key === 'Escape' && !busy) { ev.stopPropagation(); } }; document.addEventListener('keydown', k, true); return () => document.removeEventListener('keydown', k, true); }, [busy]);
  const done = async () => {
    const a = api.current; if (!a) return; setBusy(true); setErr('');
    try {
      const els = a.getSceneElements().filter(x => !x.isDeleted), st = a.getAppState(), files = a.getFiles();
      const json = mod.serializeAsJSON(els, st, files, 'local');
      const view = { ...st, exportBackground: true, exportWithDarkMode: false };
      const svg = els.length ? (await mod.exportToSvg({ elements: els, appState: view, files })).outerHTML : '';
      const png = els.length ? await b64(await mod.exportToBlob({ elements: els, appState: view, files, mimeType: 'image/png' })) : '';
      const description = els.filter(x => x.type === 'text').map(x => x.text).join('\n');
      await put(base + '.excalidraw', { json, svg, png, description }); onClose(true);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const ready = mod && scene;
  return e('div', { className: 'draw-modal', role: 'dialog', 'aria-label': 'Drawing' },
    e('div', { className: 'draw-bar' }, e('b', {}, title || 'Drawing'), e('span', { className: 'draw-err' }, err), e('span', { className: 'draw-spacer' }),
      e('button', { type: 'button', className: 'draw-btn', onClick: () => onClose(false), disabled: busy }, 'Cancel'), e('button', { type: 'button', className: 'draw-btn draw-done', onClick: done, disabled: busy || !ready }, busy ? 'Saving…' : 'Done')),
    e('div', { className: 'draw-canvas' }, ready ? e(mod.Excalidraw, { initialData: { elements: scene.elements || [], appState: { ...(scene.appState || {}), collaborators: new Map() }, files: scene.files || {}, scrollToContent: true }, excalidrawAPI: a => { api.current = a; } }) : e('div', { className: 'draw-loading' }, err ? '' : 'Loading the drawing board…')));
}
function DrawingView({ block, editor }) {
  const p = block.props, slug = slugOf(p.src), [open, setOpen] = useState(false), [missing, setMissing] = useState(false), base = `/api/drawings/${CTX.project}/${slug}`;
  if (!CTX.project) return e('div', { className: 'tb tb-draw', contentEditable: false }, e('span', { className: 'tb-tag' }, 'Drawing'), e('span', { className: 'tb-draw-empty' }, 'Create the page first, then draw on it.'));
  return e('div', { className: 'tb tb-draw', contentEditable: false },
    e('div', { className: 'tb-draw-head' }, e('span', { className: 'tb-tag' }, 'Drawing'), field('tb-url tb-draw-title', p.title, 'Title', v => editor.updateBlock(block, { props: { title: v } }), 'Drawing title'), e('button', { type: 'button', className: 'tb-btn', onClick: () => setOpen(true) }, missing ? 'Draw' : 'Edit')),
    missing ? e('div', { className: 'tb-draw-empty', onClick: () => setOpen(true) }, 'Empty drawing. Click to draw.')
      : e('img', { className: 'tb-draw-img', src: `${base}.svg?v=${p.v}`, alt: p.title, onError: () => setMissing(true), onLoad: () => setMissing(false), onClick: () => setOpen(true) }),
    open ? createPortal(e(DrawEditor, { base, title: p.title, onClose: saved => { setOpen(false); if (saved) { setMissing(false); editor.updateBlock(block, { props: { v: String(Date.now()) } }); } } }), document.body) : null);
}
const Drawing = createReactBlockSpec({ type: 'drawing', propSchema: { src: { default: '' }, title: { default: 'Drawing' }, v: { default: '0' } }, content: 'none' }, { render: ({ block, editor }) => e(DrawingView, { block, editor }) });

// the blocks a Markdown page can hold: no images, audio, video or files, which it cannot
const { audio, file, image, video, toggleListItem, divider, ...plain } = defaultBlockSpecs;   // eslint-disable-line no-unused-vars
const schema = BlockNoteSchema.create({ blockSpecs: { ...plain, milestone: Milestone(), ref: Ref(), update: Update(), typed: Typed(), drawing: Drawing() } });
const ITEM = new Set(['milestone', 'ref', 'update', 'typed', 'drawing']);

const text = s => [{ type: 'text', text: s, styles: {} }];
const plainText = content => (Array.isArray(content) ? content.map(c => (c.type === 'link' ? plainText(c.content) : c.text || '')).join('') : '').replace(/\s+/g, ' ').trim();

// ---- Markdown → blocks: prose between the item lines is parsed by BlockNote, each item line becomes its block
async function toBlocks(editor, md) {
  const out = []; let buf = [];
  const flush = async () => { const t = buf.join('\n').trim(); buf = []; if (t) out.push(...await editor.tryParseMarkdownToBlocks(t)); };
  for (const line of md.split('\n')) {
    const x = L.parseLine(line);
    if (!x) { buf.push(line); continue; }
    await flush();
    if (x.type === 'task') out.push({ type: 'milestone', props: { mid: x.id, status: x.status, owner: x.owner, due: x.due }, content: text(x.title) });
    else if (x.type === 'log') out.push({ type: 'update', props: { ts: x.ts, source: x.source }, content: text(x.text) });
    else if (x.type === 'node') out.push({ type: 'typed', props: { kind: x.kind, tid: x.id.slice(x.kind.length + 1), status: x.status, data: JSON.stringify(x.props) }, content: text(x.text) });
    else if (x.type === 'drawing') out.push({ type: 'drawing', props: { src: x.src, title: x.title || 'Drawing' } });
    else out.push({ type: 'ref', props: { kind: x.type, url: x.url === 'https://' ? '' : x.url, meta: x.meta }, content: text(x.label) });
  }
  await flush();
  if (!out.length || out[0].type !== 'paragraph') out.unshift({ type: 'paragraph' });   // somewhere to start typing above the first heading
  return out;
}

// ---- blocks → Markdown
async function fromBlocks(editor, o) {
  const parts = []; let group = [];
  let n = 0; for (const b of editor.document) if (b.type === 'milestone') n = Math.max(n, +(/\.(\d+)$/.exec(b.props.mid) || [0, 0])[1]);
  const flush = async () => { if (group.length) { const md = (await editor.blocksToMarkdownLossy(group)).trim(); if (md) parts.push({ md }); } group = []; };
  for (const b of editor.document) {
    if (!ITEM.has(b.type)) { group.push(b); continue; }
    await flush();
    const title = plainText(b.content), p = b.props;
    if (b.type === 'milestone') parts.push({ line: L.taskLine({ id: p.mid || `${o.idPrefix || 'task:new.'}${++n}`, title: title || 'Untitled milestone', status: p.status, owner: p.owner, due: p.due }, o.node || 'initiative:TBD') });
    else if (b.type === 'ref') parts.push({ line: L.refLine({ type: p.kind, label: title, url: p.url || 'https://', meta: p.meta || (p.kind === 'pr' ? today() : 'manual') }) });
    else if (b.type === 'typed') { let data = {}; try { data = JSON.parse(p.data); } catch { /* none */ } parts.push({ line: L.nodeLine({ id: `${p.kind}:${p.tid || `${CTX.scope}.1`}`, text: title, status: p.status, props: data }) }); }
    else if (b.type === 'drawing') parts.push({ line: L.drawingLine({ title: p.title, src: p.src }) });
    else parts.push({ line: L.logLine({ ts: p.ts || stamp(), source: p.source || 'manual', text: title || '(empty update)' }) });
  }
  await flush();
  return parts.reduce((s, part, i) => (i === 0 ? '' : s + (part.line && parts[i - 1].line && !/^!\[/.test(part.line) && !/^!\[/.test(parts[i - 1].line) ? '\n' : '\n\n')) + (part.md ?? part.line), '').trim();
}

const NOT_ON_A_PAGE = new Set(['Image', 'Video', 'Audio', 'File', 'Emoji', 'Toggle List', 'Toggle Heading 1', 'Toggle Heading 2', 'Toggle Heading 3', 'Divider']);
const newDrawing = () => ({ type: 'drawing', props: { src: `drawings/drawing-${Date.now().toString(36)}.excalidraw`, title: 'Drawing', v: '0' } });
const itemMenu = (editor, kinds) => [
  { kind: 'milestone', title: 'Milestone', subtext: 'A deliverable with a status, an owner and a due date', group: 'WyePoint', aliases: ['task', 'todo', 'milestone'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'milestone' }) },
  { kind: 'link', title: 'Link', subtext: 'A spec, a design, a ticket', group: 'WyePoint', aliases: ['url', 'ticket', 'doc'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'link', meta: 'manual' } }) },
  { kind: 'pr', title: 'Pull request', subtext: 'A PR that delivers this', group: 'WyePoint', aliases: ['pr', 'github'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'pr', meta: today() } }) },
  { kind: 'update', title: 'Update', subtext: 'A dated line in the log', group: 'WyePoint', aliases: ['log', 'status', 'news'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'update', props: { ts: stamp(), source: 'manual' } }) },
].filter(i => !kinds || kinds.includes(i.kind));
const extraMenu = editor => [
  ...(CTX.project ? [{ title: 'Drawing', subtext: 'Sketch, diagram or whiteboard (Excalidraw)', group: 'WyePoint', aliases: ['draw', 'excalidraw', 'diagram', 'sketch', 'whiteboard'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, newDrawing()) }] : []),
  ...CTX.types.map(t => ({ title: t.name, subtext: t.purpose, group: 'Your types', aliases: [t.slug, t.plural.toLowerCase()], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'typed', props: { kind: t.slug, tid: nextTid(editor, t.slug), status: t.statuses[0] || '', data: '{}' } }) })),
];
const HEADINGS = { milestone: 'Milestones', link: 'Links', pr: 'Pull requests', update: 'Updates', drawing: 'Drawings' };
const INSERT = { milestone: { type: 'milestone' }, link: { type: 'ref', props: { kind: 'link', meta: 'manual' } }, pr: { type: 'ref', props: { kind: 'pr', meta: today() } }, update: { type: 'update', props: { ts: stamp(), source: 'manual' } } };

function Editor({ markdown, opts, onReady, onChange }) {
  const editor = useCreateBlockNote({ schema });
  const loading = useRef(true), timer = useRef(0), last = useRef(markdown);
  const read = () => fromBlocks(editor, opts);
  const flush = async () => { clearTimeout(timer.current); if (loading.current) return; const md = await read(); if (md !== last.current) { last.current = md; onChange(md); } };
  const load = async md => {
    loading.current = true;
    try { editor.replaceBlocks(editor.document, await toBlocks(editor, md)); last.current = await read(); } finally { loading.current = false; }
  };
  // kind: milestone | link | pr | update | drawing | type:<slug> — after the last block of its kind, else under the heading for it, else under one made for it
  const insert = kind => {
    const doc = editor.document, t = kind.startsWith('type:') ? typeOf(kind.slice(5)) : null;
    const spec = t ? { type: 'typed', props: { kind: t.slug, tid: nextTid(editor, t.slug), status: t.statuses[0] || '', data: '{}' } } : kind === 'drawing' ? newDrawing() : INSERT[kind];
    if (!spec) return;
    const title = t ? t.plural : HEADINGS[kind], item = { ...spec, props: { ...(spec.props || {}) } };
    const same = b => b.type === spec.type && (spec.type === 'ref' ? b.props.kind === spec.props.kind : spec.type === 'typed' ? b.props.kind === spec.props.kind : true);
    const at = [...doc].reverse().find(same) || doc.find(b => b.type === 'heading' && plainText(b.content).toLowerCase() === title.toLowerCase());
    const [first, made] = at ? [editor.insertBlocks([item], at, 'after')[0]] : editor.insertBlocks([{ type: 'heading', props: { level: 2 }, content: text(title) }, item], doc[doc.length - 1], 'after');
    editor.setTextCursorPosition(made || first, 'end'); editor.focus();
  };
  useEffect(() => { load(markdown); onReady({ setMarkdown: load, flush, insert }); return () => clearTimeout(timer.current); }, []);   // eslint-disable-line
  return e(BlockNoteView, { editor, theme: 'light', slashMenu: false, onChange: () => { if (loading.current) return; clearTimeout(timer.current); timer.current = setTimeout(flush, SAVE_AFTER); }, onBlur: flush },
    e(SuggestionMenuController, { triggerCharacter: '/', getItems: async q => filterSuggestionItems([...getDefaultReactSlashMenuItems(editor).filter(i => !NOT_ON_A_PAGE.has(i.title)), ...itemMenu(editor, opts.kinds), ...extraMenu(editor)], q) }));
}

// mountEditor(element, { markdown, onChange(md), node, idPrefix, kinds, types, people, scope, project })
export function mountEditor(element, { markdown = '', onChange = () => {}, node, idPrefix, kinds, types = [], people = [], scope = 'new', project = '' }) {
  CTX = { types, people, scope, project }; L.setKinds(types.map(t => t.slug));
  const root = createRoot(element); let api = { setMarkdown() {}, flush() {}, insert() {} };
  root.render(e(Editor, { markdown, opts: { node, idPrefix, kinds }, onChange, onReady: a => { api = a; } }));
  return { setMarkdown: md => api.setMarkdown(md), flush: () => api.flush(), insert: k => api.insert(k), destroy: () => { api.flush(); setTimeout(() => root.unmount()); } };
}

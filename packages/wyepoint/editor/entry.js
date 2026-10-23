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
let CTX = { types: [], people: [], scope: 'new', project: '', plain: false };
const typeOf = k => CTX.types.find(t => t.slug === k);
const nextTid = (editor, kind) => { let n = 0; for (const b of editor.document) if (b.type === 'typed' && b.props.kind === kind) n = Math.max(n, +(/\.(\d+)$/.exec(b.props.tid) || [0, 0])[1]); return `${CTX.scope}.${n + 1}`; };

// a field on a block: committed when it loses focus or on Enter, so typing in it never re-renders the block
const field = (cls, value, placeholder, commit, label, type = 'text') => e('input', {
  className: cls, type, defaultValue: value, placeholder, 'aria-label': label, contentEditable: false, spellCheck: false,
  onBlur: ev => { if (ev.target.value !== value) commit(ev.target.value); }, onKeyDown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } },
});

// a person lookup: type a name, pick from the directory (a name that is not in it can still be used as typed).
// `slugs`: the value is a person:slug reference (a field of a type) rather than a name
function PersonField({ value, onCommit, label, slugs = false, className = 'tb-small' }) {
  const shown = slugs ? (CTX.people.find(p => `person:${p.slug}` === value) || {}).name || '' : value;
  const [text, setText] = useState(shown), [open, setOpen] = useState(false), [at, setAt] = useState(0);
  useEffect(() => setText(shown), [shown]);
  const q = text.trim().toLowerCase();
  const found = CTX.people.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 6);
  const typed = q && !CTX.people.some(p => p.name.toLowerCase() === q) && !slugs;
  const options = [...found.map(p => ({ label: p.name, value: slugs ? `person:${p.slug}` : p.name })), ...(typed ? [{ label: `Use “${text.trim()}”`, value: text.trim() }] : [])];
  const done = v => { setOpen(false); if (v !== value) onCommit(v); };
  return e('span', { className: 'tb-picker', contentEditable: false },
    e('input', { className, value: text, placeholder: label.toLowerCase(), 'aria-label': label, autoComplete: 'off', spellCheck: false, role: 'combobox', 'aria-expanded': open,
      onFocus: ev => { ev.target.select(); setOpen(true); setAt(0); },
      onChange: ev => { setText(ev.target.value); setOpen(true); setAt(0); },
      onBlur: () => { setOpen(false); const t = text.trim(); if (!t) done(''); else if (!slugs) done(t); else setText(shown); },
      onKeyDown: ev => {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); setOpen(true); setAt(Math.min(at + 1, options.length - 1)); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); setAt(Math.max(at - 1, 0)); }
        else if (ev.key === 'Enter') { ev.preventDefault(); const o = open && options[at]; if (o) done(o.value); ev.target.blur(); }
        else if (ev.key === 'Escape') { setText(shown); setOpen(false); ev.target.blur(); }
      } }),
    open && options.length ? e('div', { className: 'tb-menu', role: 'listbox' }, options.map((o, k) => e('div', { key: o.value, role: 'option', className: 'tb-opt' + (k === at ? ' on' : ''), onMouseDown: ev => { ev.preventDefault(); done(o.value); } }, o.label))) : null);
}

const Milestone = createReactBlockSpec(
  { type: 'milestone', propSchema: { mid: { default: '' }, key: { default: '' }, status: { default: 'todo' }, owner: { default: '' }, due: { default: '' } }, content: 'inline' },
  { render: ({ block, editor, contentRef }) => {
    const p = block.props, set = patch => editor.updateBlock(block, { props: patch });
    return e('div', { className: `tb tb-milestone st-${p.status}` },
      e('select', { className: 'tb-status', value: p.status, contentEditable: false, 'aria-label': 'Milestone status', onChange: ev => set({ status: ev.target.value }) }, STATUSES.map(([v, l]) => e('option', { key: v, value: v }, l))),
      p.key ? e('span', { className: 'tb-key', contentEditable: false, title: 'Global id: #/k/' + p.key }, p.key) : null,
      e('div', { className: 'tb-title', ref: contentRef }),
      e(PersonField, { value: p.owner, onCommit: v => set({ owner: v }), label: 'Owner' }),
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
  if (f.kind === 'person') return e(PersonField, { key, value, onCommit: commit, label: f.name, slugs: true, className: 'tb-fval' });
  return field('tb-fval', value, '–', commit, f.name, f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text');
};
// how a status reads: where the thing stands, as a colour (the first status is where a new one starts)
const tone = (t, status) => /^(closed|done|mitigated|resolved|complete|shipped|accepted)$/.test(status) ? (status === 'accepted' ? 'mute' : 'ok') : status === (t.statuses[0] || '') ? 'warn' : 'info';
const textOf = content => (content || []).map(c => c.text || '').join('');
const personName = v => (CTX.people.find(p => `person:${p.slug}` === v) || {}).name || v;

// the facts of an instance, as chips: a person is a name, a choice is coloured by its option, the rest reads "name value"
function Chips({ t, data, onOpen }) {
  const out = [];
  for (const f of t.fields) {
    const v = data[f.name]; if (!v) continue;
    if (f.kind === 'person') out.push(e('span', { key: f.name, className: 'tb-chip tb-who', title: f.name }, e('i', {}, personName(v).slice(0, 1)), personName(v)));
    else if (f.kind === 'choice') out.push(e('span', { key: f.name, className: `tb-chip tb-opt-${f.options.indexOf(v) < 0 ? 'x' : ['low', 'mid', 'high'][Math.min(2, Math.round(f.options.indexOf(v) * 2 / Math.max(1, f.options.length - 1)))]}`, title: f.name }, v));
    else if (f.kind === 'bool') out.push(e('span', { key: f.name, className: 'tb-chip' }, f.name.replace(/-/g, ' ')));
    else out.push(e('span', { key: f.name, className: 'tb-chip', title: f.name }, e('b', {}, f.name.replace(/-/g, ' ')), ' ', v.length > 48 ? v.slice(0, 47) + '…' : v));
  }
  return out.length ? e('div', { className: 'tb-chips', contentEditable: false, onClick: onOpen }, out) : null;
}

// the notes of an instance: a small document of its own (the same editor), kept as Markdown in the block
function Notes({ value, onChange }) {
  const editor = useCreateBlockNote({ uploadFile, resolveFileUrl });
  const ready = useRef(false), timer = useRef(0);
  useEffect(() => { let live = true; (async () => { if (value.trim()) { const b = await parseMd(editor, value); if (live) editor.replaceBlocks(editor.document, b); } ready.current = true; })(); return () => { live = false; clearTimeout(timer.current); }; }, []);
  const save = () => { clearTimeout(timer.current); timer.current = setTimeout(async () => { if (!ready.current) return; const md = await toMd(editor, editor.document); if (md !== value.trim()) onChange(md); }, 600); };
  return e('div', { className: 'tb-notes' }, e('div', { className: 'tb-notes-label' }, 'Notes'),
    e(BlockNoteView, { editor, theme: 'light', onChange: save, sideMenu: false }));
}

// the context of one instance: everything about it, in a panel beside the page
function TypedDrawer({ block, editor, t, data, title, onClose }) {
  useEffect(() => { const k = ev => { if (ev.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const set = patch => editor.updateBlock(block, { props: patch });
  const setData = (k, v) => set({ data: JSON.stringify({ ...data, [k]: v }) });
  const p = block.props;
  return createPortal(e('div', { className: 'tb-overlay', onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); } },
    e('aside', { className: 'tb-drawer', role: 'dialog', 'aria-label': t.name },
      e('div', { className: 'tb-drawer-head' }, e('span', { className: `tb-tag tb-kind tone-${tone(t, p.status)}` }, t.name), e('span', { className: 'tb-id' }, data.key ? `${data.key} · ${p.tid}` : p.tid), e('button', { className: 'tb-x', 'aria-label': 'Close', onClick: onClose }, '✕')),
      e('h3', { className: 'tb-drawer-title' }, title || 'Untitled'),
      e('div', { className: 'tb-drawer-note' }, t.purpose, ' · edit the text on the page'),
      t.statuses.length ? e('label', { className: 'tb-drow' }, e('span', {}, 'Status'),
        e('select', { value: p.status, 'aria-label': 'Status', onChange: ev => set({ status: ev.target.value }) }, t.statuses.map(s => e('option', { key: s, value: s }, s.replace(/-/g, ' '))))) : null,
      t.fields.map(f => e('label', { key: f.name, className: 'tb-drow' }, e('span', {}, f.name.replace(/-/g, ' ')), control(f, data[f.name] || '', v => setData(f.name, v)))),
      e(Notes, { value: p.notes || '', onChange: md => set({ notes: md }) }),
      e('div', { className: 'tb-drawer-foot' }, 'Saved with the page. In the vault it is the line ', e('code', {}, `${p.kind}:${p.tid}`), '.'))), document.body);
}

function TypedView({ block, editor, contentRef }) {
  const [open, setOpen] = useState(false);
  const p = block.props, t = typeOf(p.kind);
  let data = {}; try { data = JSON.parse(p.data); } catch { /* an empty block */ }
  if (!t) return e('div', { className: 'tb tb-typed' }, e('span', { className: 'tb-tag', contentEditable: false }, p.kind), e('div', { className: 'tb-title', ref: contentRef }));   // its type was removed
  const tn = tone(t, p.status), opener = { onClick: () => setOpen(true), role: 'button', tabIndex: 0, onKeyDown: ev => { if (ev.key === 'Enter') setOpen(true); } };
  return e('div', { className: `tb tb-typed tone-${tn}` },
    e('div', { className: 'tb-typed-head' },
      e('span', { className: `tb-tag tb-kind tone-${tn}`, contentEditable: false, title: t.purpose }, t.name),
      data.key ? e('span', { className: 'tb-key', contentEditable: false, title: 'Global id: #/k/' + data.key }, data.key) : null,
      e('div', { className: 'tb-title', ref: contentRef }),
      p.status ? e('span', { className: `tb-state tone-${tn}`, contentEditable: false, ...opener, title: 'Open' }, p.status.replace(/-/g, ' ')) : null,
      e('button', { className: 'tb-open-btn', contentEditable: false, 'aria-label': `Open ${t.name}`, title: 'Open', onClick: () => setOpen(true) }, '⤢')),
    e(Chips, { t, data, onOpen: () => setOpen(true) }),
    p.notes && p.notes.trim() ? e('div', { className: 'tb-snippet', contentEditable: false, ...opener }, p.notes.replace(/[#*_`>\[\]-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)) : null,
    open ? e(TypedDrawer, { block, editor, t, data, title: textOf(block.content), onClose: () => setOpen(false) }) : null);
}
const Typed = createReactBlockSpec(
  { type: 'typed', propSchema: { kind: { default: '' }, tid: { default: '' }, status: { default: '' }, data: { default: '{}' }, notes: { default: '' } }, content: 'inline' },
  { render: props => e(TypedView, props) },
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
const { audio, file, video, toggleListItem, divider, ...plain } = defaultBlockSpecs;   // eslint-disable-line no-unused-vars
const schema = BlockNoteSchema.create({ blockSpecs: { ...plain, milestone: Milestone(), ref: Ref(), update: Update(), typed: Typed(), drawing: Drawing() } });
const ITEM = new Set(['milestone', 'ref', 'update', 'typed', 'drawing']);

const text = s => [{ type: 'text', text: s, styles: {} }];
const plainText = content => (Array.isArray(content) ? content.map(c => (c.type === 'link' ? plainText(c.content) : c.text || '')).join('') : '').replace(/\s+/g, ' ').trim();

// ---- pictures: pasted or dropped, uploaded to the project, kept in the page as images/<file>
async function uploadFile(file) {
  if (!CTX.project) throw new Error('Create the initiative first; a picture is kept with its project');
  const token = localStorage.getItem('wyepoint_token') || '';
  const send = async tok => fetch(`/api/images/${encodeURIComponent(CTX.project)}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: file });
  let r = await send(token);
  if (r.status === 401) { const t = window.prompt('This server needs its write token to save changes:'); if (t) { localStorage.setItem('wyepoint_token', t.trim()); r = await send(t.trim()); } }
  const j = await r.json().catch(() => ({})); if (!r.ok) { window.alert(j.error || `could not save the picture (${r.status})`); throw new Error(j.error || 'upload failed'); }
  return j.url;
}
const resolveFileUrl = async url => (/^images\//.test(url) && CTX.project ? `/api/images/${encodeURIComponent(CTX.project)}/${url.slice(7)}` : url);

// ---- a picture's size: the editor keeps it as `previewWidth`, Markdown has nowhere for it, so it goes in the alt text,
// ![caption|640](images/x.png) (as Obsidian writes it). Plain Markdown readers still show the picture and a caption.
const WIDTH = /!\[([^\]]*?)\|(\d{2,4})\]\(([^)\s]+)\)/g;
const readWidths = md => { const widths = {}; return { md: md.replace(WIDTH, (_, alt, n, url) => { widths[url] = +n; return `![${alt}](${url})`; }), widths }; };
const applyWidths = (blocks, widths) => { for (const b of blocks) { if (b.type === 'image' && widths[b.props.url]) b.props.previewWidth = widths[b.props.url]; if (b.children) applyWidths(b.children, widths); } return blocks; };
const pictures = (blocks, out = []) => { for (const b of blocks) { if (b.type === 'image' && b.props.url && Number(b.props.previewWidth) > 0) out.push([b.props.url, Math.round(b.props.previewWidth)]); if (b.children) pictures(b.children, out); } return out; };
const writeWidths = (md, blocks) => pictures(blocks).reduce((m, [url, w]) => m.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), (all, alt) => (/\|\d+$/.test(alt) ? all : `![${alt}|${w}](${url})`)), md);
const parseMd = async (editor, md) => { const r = readWidths(md); return applyWidths(await editor.tryParseMarkdownToBlocks(r.md), r.widths); };
const toMd = async (editor, blocks) => writeWidths((await editor.blocksToMarkdownLossy(blocks)).trim(), blocks);

// ---- Markdown → blocks: prose between the item lines is parsed by BlockNote, each item line becomes its block
async function toBlocks(editor, md) {
  const out = []; let buf = [];
  const flush = async () => { const t = buf.join('\n').trim(); buf = []; if (t) out.push(...await parseMd(editor, t)); };
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], x = L.parseLine(line);
    if (!x) { buf.push(line); continue; }
    await flush();
    if (x.type === 'task') out.push({ type: 'milestone', props: { mid: x.id, key: x.key, status: x.status, owner: x.owner, due: x.due }, content: text(x.title) });
    else if (x.type === 'log') out.push({ type: 'update', props: { ts: x.ts, source: x.source }, content: text(x.text) });
    else if (x.type === 'node') out.push({ type: 'typed', props: { kind: x.kind, tid: x.id.slice(x.kind.length + 1), status: x.status, data: JSON.stringify(x.props), notes: (() => { const n = []; while (i + 1 < lines.length && /^ {2}/.test(lines[i + 1])) n.push(lines[++i].slice(2)); return n.join('\n').trim(); })() }, content: text(x.text) });
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
  const flush = async () => { if (group.length) { const md = await toMd(editor, group); if (md) parts.push({ md }); } group = []; };
  for (const b of editor.document) {
    if (!ITEM.has(b.type)) { group.push(b); continue; }
    await flush();
    const title = plainText(b.content), p = b.props;
    if (b.type === 'milestone') parts.push({ line: L.taskLine({ id: p.mid || `${o.idPrefix || 'task:new.'}${++n}`, title: title || 'Untitled milestone', status: p.status, owner: p.owner, due: p.due, key: p.key }, o.node || 'project:TBD') });
    else if (b.type === 'ref') parts.push({ line: L.refLine({ type: p.kind, label: title, url: p.url || 'https://', meta: p.meta || (p.kind === 'pr' ? today() : 'manual') }) });
    else if (b.type === 'typed') { let data = {}; try { data = JSON.parse(p.data); } catch { /* none */ } parts.push({ line: L.nodeLine({ id: `${p.kind}:${p.tid || `${CTX.scope}.1`}`, text: title, status: p.status, props: data }) + (p.notes && p.notes.trim() ? '\n' + p.notes.trim().split('\n').map(l => ('  ' + l).replace(/\s+$/, l.trim() ? '' : '  ')).join('\n') : '') }); }
    else if (b.type === 'drawing') parts.push({ line: L.drawingLine({ title: p.title, src: p.src }) });
    else parts.push({ line: L.logLine({ ts: p.ts || stamp(), source: p.source || 'manual', text: title || '(empty update)' }) });
  }
  await flush();
  return parts.reduce((s, part, i) => (i === 0 ? '' : s + (part.line && parts[i - 1].line && !/^!\[/.test(part.line) && !/^!\[/.test(parts[i - 1].line) ? '\n' : '\n\n')) + (part.md ?? part.line), '').trim();
}

const NOT_ON_A_PAGE = new Set(['Video', 'Audio', 'File', 'Emoji', 'Toggle List', 'Toggle Heading 1', 'Toggle Heading 2', 'Toggle Heading 3', 'Divider']);
const newDrawing = () => ({ type: 'drawing', props: { src: `drawings/drawing-${Date.now().toString(36)}.excalidraw`, title: 'Drawing', v: '0' } });
const itemMenu = (editor, kinds) => [
  { kind: 'milestone', title: 'Milestone', subtext: 'A deliverable with a status, an owner and a due date', group: 'WyePoint', aliases: ['task', 'todo', 'milestone'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'milestone' }) },
  { kind: 'link', title: 'Link', subtext: 'A spec, a design, a ticket', group: 'WyePoint', aliases: ['url', 'ticket', 'doc'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'link', meta: 'manual' } }) },
  { kind: 'pr', title: 'Pull request', subtext: 'A PR that delivers this', group: 'WyePoint', aliases: ['pr', 'github'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'pr', meta: today() } }) },
  { kind: 'update', title: 'Update', subtext: 'A dated line in the log', group: 'WyePoint', aliases: ['log', 'status', 'news'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'update', props: { ts: stamp(), source: 'manual' } }) },
].filter(i => !kinds || kinds.includes(i.kind));
const extraMenu = editor => CTX.plain ? [] : [
  ...(CTX.project ? [{ title: 'Drawing', subtext: 'Sketch, diagram or whiteboard (Excalidraw)', group: 'WyePoint', aliases: ['draw', 'excalidraw', 'diagram', 'sketch', 'whiteboard'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, newDrawing()) }] : []),
  ...CTX.types.map(t => ({ title: t.name, subtext: t.purpose, group: 'Your types', aliases: [t.slug, t.plural.toLowerCase()], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'typed', props: { kind: t.slug, tid: nextTid(editor, t.slug), status: t.statuses[0] || '', data: '{}' } }) })),
];
const HEADINGS = { milestone: 'Milestones', link: 'Links', pr: 'Pull requests', update: 'Updates', drawing: 'Drawings' };
const INSERT = { milestone: { type: 'milestone' }, link: { type: 'ref', props: { kind: 'link', meta: 'manual' } }, pr: { type: 'ref', props: { kind: 'pr', meta: today() } }, update: { type: 'update', props: { ts: stamp(), source: 'manual' } } };

function Editor({ markdown, opts, onReady, onChange }) {
  const editor = useCreateBlockNote({ schema, uploadFile, resolveFileUrl });
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
export function mountEditor(element, { markdown = '', onChange = () => {}, node, idPrefix, kinds, types = [], people = [], scope = 'new', project = '', plain = false }) {
  CTX = { types, people, scope, project, plain }; L.setKinds(types.map(t => t.slug));
  const root = createRoot(element); let api = { setMarkdown() {}, flush() {}, insert() {} };
  root.render(e(Editor, { markdown, opts: { node, idPrefix, kinds }, onChange, onReady: a => { api = a; } }));
  return { setMarkdown: md => api.setMarkdown(md), flush: () => api.flush(), insert: k => api.insert(k), destroy: () => { api.flush(); setTimeout(() => root.unmount()); } };
}

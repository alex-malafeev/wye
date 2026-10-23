// The Notion-style editor WyePoint uses for an initiative's page — BlockNote, the library Wye's own document editor is
// built on. The page is one document: prose as ordinary blocks, and four block types for the items a planner keeps
// (milestone, link, pull request, update) that can be inserted anywhere with "/". Markdown goes in and comes out, in
// the line formats of lib/lines.js, so the vault keeps plain Markdown. Built by `npm run build:editor` into
// public/vendor/ and loaded on demand.
import { createElement as e, useEffect, useRef } from 'react';
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

// a field on a block: committed when it loses focus or on Enter, so typing in it never re-renders the block
const field = (cls, value, placeholder, commit, label) => e('input', {
  className: cls, defaultValue: value, placeholder, 'aria-label': label, contentEditable: false, spellCheck: false,
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

// the blocks a Markdown page can hold: no images, audio, video or files, which it cannot
const { audio, file, image, video, toggleListItem, divider, ...plain } = defaultBlockSpecs;   // eslint-disable-line no-unused-vars
const schema = BlockNoteSchema.create({ blockSpecs: { ...plain, milestone: Milestone(), ref: Ref(), update: Update() } });
const ITEM = new Set(['milestone', 'ref', 'update']);

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
    if (b.type === 'milestone') parts.push({ line: L.taskLine({ id: p.mid || `${o.idPrefix || 'task:new.'}${++n}`, title: title || 'Untitled milestone', status: p.status, owner: p.owner, due: p.due }, o.node || 'goal:TBD') });
    else if (b.type === 'ref') parts.push({ line: L.refLine({ type: p.kind, label: title, url: p.url || 'https://', meta: p.meta || (p.kind === 'pr' ? today() : 'manual') }) });
    else parts.push({ line: L.logLine({ ts: p.ts || stamp(), source: p.source || 'manual', text: title || '(empty update)' }) });
  }
  await flush();
  return parts.reduce((s, part, i) => (i === 0 ? '' : s + (part.line && parts[i - 1].line ? '\n' : '\n\n')) + (part.md ?? part.line), '').trim();
}

const NOT_ON_A_PAGE = new Set(['Image', 'Video', 'Audio', 'File', 'Emoji', 'Toggle List', 'Toggle Heading 1', 'Toggle Heading 2', 'Toggle Heading 3', 'Divider']);
const itemMenu = (editor, kinds) => [
  { kind: 'milestone', title: 'Milestone', subtext: 'A deliverable with a status, an owner and a due date', group: 'WyePoint', aliases: ['task', 'todo', 'milestone'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'milestone' }) },
  { kind: 'link', title: 'Link', subtext: 'A spec, a design, a ticket', group: 'WyePoint', aliases: ['url', 'ticket', 'doc'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'link', meta: 'manual' } }) },
  { kind: 'pr', title: 'Pull request', subtext: 'A PR that delivers this', group: 'WyePoint', aliases: ['pr', 'github'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'ref', props: { kind: 'pr', meta: today() } }) },
  { kind: 'update', title: 'Update', subtext: 'A dated line in the log', group: 'WyePoint', aliases: ['log', 'status', 'news'], onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'update', props: { ts: stamp(), source: 'manual' } }) },
].filter(i => !kinds || kinds.includes(i.kind));
const HEADINGS = { milestone: 'Milestones', link: 'Links', pr: 'Pull requests', update: 'Updates' };
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
  const insert = kind => {
    const spec = INSERT[kind]; if (!spec) return;
    // after the last block of its kind, else under the heading for it, else under a heading made for it at the end
    const doc = editor.document, title = HEADINGS[kind], item = { ...spec, props: { ...(spec.props || {}) } };
    const same = b => b.type === spec.type && (spec.type !== 'ref' || b.props.kind === spec.props.kind);
    const at = [...doc].reverse().find(same) || doc.find(b => b.type === 'heading' && plainText(b.content).toLowerCase() === title.toLowerCase());
    const [first, made] = at ? [editor.insertBlocks([item], at, 'after')[0]] : editor.insertBlocks([{ type: 'heading', props: { level: 2 }, content: text(title) }, item], doc[doc.length - 1], 'after');
    editor.setTextCursorPosition(made || first, 'end'); editor.focus();
  };
  useEffect(() => { load(markdown); onReady({ setMarkdown: load, flush, insert }); return () => clearTimeout(timer.current); }, []);   // eslint-disable-line
  return e(BlockNoteView, { editor, theme: 'light', slashMenu: false, onChange: () => { if (loading.current) return; clearTimeout(timer.current); timer.current = setTimeout(flush, SAVE_AFTER); }, onBlur: flush },
    e(SuggestionMenuController, { triggerCharacter: '/', getItems: async q => filterSuggestionItems([...getDefaultReactSlashMenuItems(editor).filter(i => !NOT_ON_A_PAGE.has(i.title)), ...itemMenu(editor, opts.kinds)], q) }));
}

// mountEditor(element, { markdown, onChange(md), node: 'goal:p.slug', idPrefix: 'task:p.slug.' })
export function mountEditor(element, { markdown = '', onChange = () => {}, node, idPrefix, kinds }) {
  const root = createRoot(element); let api = { setMarkdown() {}, flush() {}, insert() {} };
  root.render(e(Editor, { markdown, opts: { node, idPrefix, kinds }, onChange, onReady: a => { api = a; } }));
  return { setMarkdown: md => api.setMarkdown(md), flush: () => api.flush(), insert: k => api.insert(k), destroy: () => { api.flush(); setTimeout(() => root.unmount()); } };
}

// The Notion-style block editor Tempo uses for rich text — BlockNote, the same library Wye's own document editor is
// built on — as one function: mountEditor(element, { markdown, onChange }). Markdown goes in and comes out, so the
// vault keeps what it always kept. Built by `npm run build:editor` into public/vendor/ and loaded on demand.
import { createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

const SAVE_AFTER = 700;   // ms of quiet before a change is handed back

function Editor({ markdown, onReady, onChange }) {
  const editor = useCreateBlockNote();
  const loading = useRef(true), timer = useRef(0), last = useRef(markdown);
  const read = async () => (await editor.blocksToMarkdownLossy(editor.document)).trim();
  const flush = async () => { clearTimeout(timer.current); const md = await read(); if (md !== last.current) { last.current = md; onChange(md); } };
  const load = async md => { loading.current = true; last.current = md.trim(); const blocks = await editor.tryParseMarkdownToBlocks(md); editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: 'paragraph' }]); loading.current = false; };
  useEffect(() => { load(markdown); onReady({ setMarkdown: load, flush }); return () => clearTimeout(timer.current); }, []);   // eslint-disable-line
  return createElement(BlockNoteView, {
    editor, theme: 'light',
    onChange: () => { if (loading.current) return; clearTimeout(timer.current); timer.current = setTimeout(flush, SAVE_AFTER); },
    onBlur: flush,
  });
}

export function mountEditor(element, { markdown = '', onChange = () => {} }) {
  const root = createRoot(element); let api = { setMarkdown() {}, flush() {} };
  root.render(createElement(Editor, { markdown, onChange, onReady: a => { api = a; } }));
  return { setMarkdown: md => api.setMarkdown(md), flush: () => api.flush(), destroy: () => { api.flush(); setTimeout(() => root.unmount()); } };
}

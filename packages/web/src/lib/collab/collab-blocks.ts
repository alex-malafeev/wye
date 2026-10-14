// A page as a live document (plan:collaboration, decision:waterfall.collab-is-a-crdt-held-by-the-server): the server
// holds the editor's blocks in a Yjs document, with the editor's own schema and no view, and turns it to and from the
// markdown the page is stored as — through the same import and serializer the editor uses, so a page reads and saves
// the same whether one person edits it or several.
import * as Y from 'yjs';
import { BlockNoteEditor, BlockNoteSchema, createBlockSpec, createInlineContentSpec, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { Window } from 'happy-dom';
import { codeBlockConfig, codeBlockParse, embedBlockConfig, collectionBlockConfig, nodeBlockConfig, drawingBlockConfig, viewBlockConfig, tagInlineConfig, imgInlineConfig } from '../editor-schema';
import { importMarkdown } from '../import';
import { blocksToMarkdown, type AnyBlock } from '../serialize';

import { FRAGMENT } from './collab-name';
export { FRAGMENT };

// never drawn: a live document has no view, so a block only needs its type, props and content
const noView = { render: () => ({ dom: globalThis.document?.createElement('div') as HTMLElement }) };
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createBlockSpec(codeBlockConfig, { ...noView, parse: codeBlockParse })(),
    node: createBlockSpec(nodeBlockConfig, noView)(),
    drawing: createBlockSpec(drawingBlockConfig, noView)(),
    collection: createBlockSpec(collectionBlockConfig, noView)(),
    view: createBlockSpec(viewBlockConfig, noView)(),
    embed: createBlockSpec(embedBlockConfig, noView)(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, tag: createInlineContentSpec(tagInlineConfig, noView), img: createInlineContentSpec(imgInlineConfig, noView) },
});

let editor: BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema> | null = null;
const ed = () => (editor ??= BlockNoteEditor.create({ schema }));

// BlockNote parses markdown through HTML, which needs a DOM: one for the length of the call only, so nothing else on
// the server ever sees a `window` and takes itself for a browser
let win: Window | null = null;
function withDom<T>(f: () => T): T {
  const g = globalThis as Record<string, unknown>; const keys = ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'Element', 'DocumentFragment'];
  if (g.document) return f();
  win ??= new Window();
  const saved = keys.map(k => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  const w = win as unknown as Record<string, unknown>;
  for (const k of keys) Object.defineProperty(g, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true });
  try { return f(); }
  finally { for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else delete g[k]; } }
}

// markdown → the editor's blocks, as the editor loads a page
export function markdownToBlocks(md: string): AnyBlock[] {
  return withDom(() => importMarkdown(md, src => ed().tryParseMarkdownToBlocks(src) as unknown as AnyBlock[]));
}
// blocks → a new live document holding them (an empty page holds one empty paragraph, as the editor does)
export function blocksToDoc(blocks: AnyBlock[], doc = new Y.Doc()): Y.Doc {
  withDom(() => blocksToYXmlFragment(ed(), (blocks.length ? blocks : [{ type: 'paragraph', content: [] }]) as never, doc.getXmlFragment(FRAGMENT)));
  return doc;
}
export const markdownToDoc = (md: string, doc?: Y.Doc) => blocksToDoc(markdownToBlocks(md), doc);
// a live document → its blocks, and → the markdown it is stored as
export const docToBlocks = (doc: Y.Doc): AnyBlock[] => withDom(() => yXmlFragmentToBlocks(ed(), doc.getXmlFragment(FRAGMENT)) as unknown as AnyBlock[]);
export const docToMarkdown = (doc: Y.Doc): string => blocksToMarkdown(docToBlocks(doc));

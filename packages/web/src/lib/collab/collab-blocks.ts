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

// ------------------------------------------------------------------ merging a write into a live page
// (decision:waterfall.outside-writes-merge-into-the-live-page) Something else wrote the page's file — an agent, the
// CLI, an approve — from `base` (the text the live document last read or wrote) to `theirs`. A three-way merge at the
// level of the page's top blocks: the blocks the writer removed are removed, the ones it added are added where it put
// them, as one Yjs transaction; every other block is left as people have it. A block the writer changed that people
// changed too is kept as they have it, the writer's version beside it — nothing typed is lost.
const keysOf = (blocks: AnyBlock[]) => blocks.map(b => blocksToMarkdown([b]).trim());
// the longest common subsequence of two key lists → for each index of `a`, its index in `b` or -1
function lcs(a: string[], b: string[]): number[] {
  const n = a.length, m = b.length, w = m + 1; const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out = new Array<number>(n).fill(-1); let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out[i++] = j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++; }
  return out;
}
export function mergeIntoDoc(doc: Y.Doc, base: string, theirs: string, origin: unknown = 'wye:write'): { changed: boolean; added: number; removed: number; kept: number } {
  const B = keysOf(markdownToBlocks(base)), theirsBlocks = markdownToBlocks(theirs), T = keysOf(theirsBlocks);
  const L = keysOf(docToBlocks(doc));
  const bt = lcs(B, T), bl = lcs(B, L);
  // a gap between two matched blocks with as many blocks on each side holds the same blocks, edited live: paired by
  // place, so what the writer puts after one of them lands after it — but never removed (people changed it)
  const near = [...bl]; let pi = -1, pk = -1;
  for (let i = 0; i <= B.length; i++) {
    if (i < B.length && bl[i] < 0) continue;
    const k = i < B.length ? bl[i] : L.length;
    if (i - pi === k - pk) for (let x = 1; x < i - pi; x++) near[pi + x] = pk + x;
    pi = i; pk = k;
  }
  const inT = new Set(bt.filter(j => j >= 0)), tToB = new Map<number, number>(); bt.forEach((j, i) => { if (j >= 0) tToB.set(j, i); });
  // where a base block is in the live page now, or the nearest one before it that still is (-1: the top)
  const liveAt = (i: number) => { for (let k = i; k >= 0; k--) if (near[k] >= 0) return near[k]; return -1; };
  const remove = new Set<number>(); let kept = 0;
  bt.forEach((j, i) => { if (j >= 0) return; if (bl[i] >= 0) remove.add(bl[i]); else kept++; });   // not in the live page: people changed it — theirs stays
  const add = new Map<number, AnyBlock[]>();   // after live index → the writer's new blocks, in order
  let anchor = -1;
  for (let j = 0; j < T.length; j++) {
    if (inT.has(j)) { anchor = liveAt(tToB.get(j)!); continue; }
    const list = add.get(anchor) ?? []; list.push(theirsBlocks[j]); add.set(anchor, list);
  }
  if (!remove.size && !add.size) return { changed: false, added: 0, removed: 0, kept };
  const group = doc.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement;
  const scratch = blocksToDoc([...add.values()].flat());
  const made = (scratch.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement).toArray() as Y.XmlElement[];
  let next = 0; const order = [...add.keys()].sort((x, y) => x - y); const chunks = new Map<number, Y.XmlElement[]>();
  for (const k of order) { const n = add.get(k)!.length; chunks.set(k, made.slice(next, next + n).map(e => e.clone() as Y.XmlElement)); next += n; }
  doc.transact(() => {
    for (let k = L.length - 1; k >= -1; k--) {
      const c = chunks.get(k); if (c?.length) group.insert(k + 1, c);
      if (k >= 0 && remove.has(k)) group.delete(k, 1);
    }
  }, origin);
  return { changed: true, added: next, removed: remove.size, kept };
}

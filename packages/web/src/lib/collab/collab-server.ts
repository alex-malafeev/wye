// The live documents (plan:collaboration, decision:waterfall.collab-is-a-crdt-held-by-the-server): one Yjs document per
// page someone has open, served by Hocuspocus over the websocket server.js hands on at /collab. It is loaded from the
// page's markdown when the first editor joins, and stored back to it — 2 s after the last change, at least every 10 s
// while people type — through the same lock, atomic write and graph rebuild as any other save. The server is the only
// writer of a live page's file: the editors no longer save whole pages, so two people never overwrite each other.
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type * as Y from 'yjs';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import { loadScope, treeFor } from '../scope';
import { loadMarkdown } from '../load';
import { REPO_ROOT } from '../products';
import { pageBySlug } from '../doc';
import { bodyOf, followHeading, hashOf, rebuild, replaceBody, withFileLock, writeAtomic } from '../write';
import { markdownToDoc, docToMarkdown } from './collab-blocks';

// a page held live: its file, the markdown the live document last read from or wrote to it (`fileBody`), and the
// markdown the live document gave then (`stored`) — a store with nothing new writes nothing
export interface LivePage { name: string; file: string; productDir: string; fileBody: string; stored: string }
export interface Collab { hocuspocus: Hocuspocus; live: Map<string, LivePage>; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void }
const g = globalThis as { __wyeCollab?: Collab };

async function locate(name: string) {
  const [product, project, ...rest] = name.split('/'); const slug = rest.join('/');
  if (!product || !project || !slug) return null;
  const scope = await loadScope(product, project); if (!scope) return null;
  const d = pageBySlug(treeFor(scope, project).byFile.values(), project, decodeURIComponent(slug));
  return d ? { file: d.file, productDir: scope.product.dir } : null;
}

const squeeze = (s: string) => s.replace(/\s+/g, '').length;
// write a live page's markdown to its file; refused when the file was changed by something else since the live
// document last read or wrote it (what changes it is merged into the live document instead — plan:collaboration
// phase 3), or when the page would lose more than half its text (the editor's own guard, kept on the server) or all of it
export async function storePage(p: LivePage, md: string): Promise<'stored' | 'same' | 'changed-on-disk' | 'shrunk'> {
  if (md === p.stored) return 'same';
  if ((squeeze(p.stored) > 0 && squeeze(md) === 0) || (squeeze(p.stored) > 200 && squeeze(md) < squeeze(p.stored) / 2)) { console.error(`wye collab: ${p.file} — a store that drops more than half the page was refused`); return 'shrunk'; }
  const abs = path.join(REPO_ROOT, p.file);
  const r = await withFileLock(abs, async () => {
    const cur = await loadMarkdown(REPO_ROOT, p.file);
    const body = bodyOf(cur);
    if (body !== p.fileBody) return 'changed-on-disk' as const;
    const w = replaceBody(cur, hashOf(body), md); if (w.error) return 'changed-on-disk' as const;
    const out = followHeading(cur, w.md);
    await writeAtomic(abs, out);
    p.fileBody = bodyOf(out); p.stored = md;
    return 'stored' as const;
  });
  if (r === 'stored') await rebuild(p.productDir).catch(e => console.error(`wye collab: rebuild after storing ${p.file}: ${(e as Error).message}`));
  else console.error(`wye collab: ${p.file} changed on disk while it was live — not overwritten`);
  return r;
}

export function startCollab(): Collab {
  if (g.__wyeCollab) return g.__wyeCollab;
  const live = new Map<string, LivePage>();
  const hocuspocus = new Hocuspocus({
    quiet: true, debounce: 2000, maxDebounce: 10_000, unloadImmediately: false,
    async onLoadDocument({ documentName, document }) {
      try { return await load(documentName, document as unknown as Y.Doc); }
      catch (e) { console.error(`wye collab: could not load ${documentName}: ${(e as Error).message}`); throw e; }
    },
    async onStoreDocument({ documentName, document }) {
      const p = live.get(documentName); if (!p) return;
      try { await storePage(p, docToMarkdown(document as unknown as Y.Doc)); }
      catch (e) { console.error(`wye collab: could not store ${documentName}: ${(e as Error).message}`); }
    },
    async afterUnloadDocument({ documentName }) { live.delete(documentName); },
  });
  async function load(documentName: string, document: Y.Doc) {
      const hit = await locate(documentName); if (!hit) throw new Error(`no page ${documentName}`);
      const fileBody = bodyOf(await loadMarkdown(REPO_ROOT, hit.file));
      markdownToDoc(fileBody, document);
      live.set(documentName, { name: documentName, file: hit.file, productDir: hit.productDir, fileBody, stored: docToMarkdown(document) });
      return document;
  }
  const wss = new WebSocketServer({ noServer: true });
  const collab: Collab = { hocuspocus, live, upgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => hocuspocus.handleConnection(ws as never, req)) };
  g.__wyeCollab = collab;
  // a server that stops stores what its live pages hold first: the last 2 s of typing are not lost on a restart
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { flushLive().finally(() => process.exit(0)); });
  return collab;
}
// every live page stored now, whatever the debounce — before the server stops or restarts (lib/agent-host)
export async function flushLive(): Promise<void> {
  const c = g.__wyeCollab; if (!c) return;
  await Promise.all([...c.hocuspocus.documents].map(async ([name, doc]) => { const p = c.live.get(name); if (p) await storePage(p, docToMarkdown(doc as unknown as Y.Doc)).catch(e => console.error(`wye collab: could not store ${name}: ${(e as Error).message}`)); }));
}
export const collab = (): Collab | undefined => g.__wyeCollab;

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
import { markdownToDoc, docToMarkdown, mergeIntoDoc } from './collab-blocks';
import { realpathSync } from 'node:fs';
import { claimWrite } from '../changes';

// a page held live: its file, the markdown the live document last read from or wrote to it (`fileBody`), and the
// markdown the live document gave then (`stored`) — a store with nothing new writes nothing
export interface LivePage { name: string; file: string; productDir: string; fileBody: string; stored: string; editors: Set<string> }
export interface Collab { hocuspocus: Hocuspocus; live: Map<string, LivePage>; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void; written(file: string, text: string): void; changedOnDisk(file: string): void }
const g = globalThis as { __wyeCollab?: Collab };

async function locate(name: string) {
  const [product, project, ...rest] = name.split('/'); const slug = rest.join('/');
  if (!product || !project || !slug) return null;
  const scope = await loadScope(product, project); if (!scope) return null;
  const d = pageBySlug(treeFor(scope, project).byFile.values(), project, decodeURIComponent(slug));
  return d ? { file: d.file, productDir: scope.product.dir } : null;
}

const squeeze = (s: string) => s.replace(/\s+/g, '').length;
const realOf = (file: string) => { try { return realpathSync(file); } catch { return path.resolve(file); } };

// what something else wrote to a live page's file, merged into its live document (decision:waterfall.outside-writes-merge-into-the-live-page)
function mergeFile(p: LivePage, doc: Y.Doc, body: string): void {
  if (body === p.fileBody) return;
  const r = mergeIntoDoc(doc, p.fileBody, body, 'wye:write');
  p.fileBody = body;
  if (r.kept) console.error(`wye collab: ${p.file} — ${r.kept} block(s) changed both live and by a write; both versions kept`);
}

// write a live page to its file. What changed the file since the live document last read or wrote it (a write in this
// app is merged at once; one from outside — git, an editor — here) is merged in first, so it is kept. Refused when the
// page would lose more than half its text, or all of it (the editor's own guard, kept on the server).
export async function storePage(p: LivePage, doc: Y.Doc): Promise<'stored' | 'same' | 'shrunk'> {
  const abs = path.join(REPO_ROOT, p.file);
  const r = await withFileLock(abs, async () => {
    const cur = await loadMarkdown(REPO_ROOT, p.file);
    const body = bodyOf(cur);
    mergeFile(p, doc, body);
    const md = docToMarkdown(doc);
    if (md === p.stored && body === p.fileBody) return 'same' as const;
    if ((squeeze(p.stored) > 0 && squeeze(md) === 0) || (squeeze(p.stored) > 200 && squeeze(md) < squeeze(p.stored) / 2)) { console.error(`wye collab: ${p.file} — a store that drops more than half the page was refused`); return 'shrunk' as const; }
    if (md === body) { p.stored = md; return 'same' as const; }
    // the people who changed it since the last store are who wrote it (plan:collaboration names)
    if (p.editors.size) { claimWrite(p.file, { by: [...p.editors].join(', ') }); p.editors.clear(); }
    const w = replaceBody(cur, hashOf(body), md);
    const out = followHeading(cur, w.md);
    await writeAtomic(abs, out, { live: true });
    p.fileBody = bodyOf(out); p.stored = md;
    return 'stored' as const;
  });
  if (r === 'stored') await rebuild(p.productDir).catch(e => console.error(`wye collab: rebuild after storing ${p.file}: ${(e as Error).message}`));
  return r;
}

export function startCollab(): Collab {
  if (g.__wyeCollab) return g.__wyeCollab;
  const live = new Map<string, LivePage>();
  const hocuspocus = new Hocuspocus({
    quiet: true, debounce: 2000, maxDebounce: 10_000, unloadImmediately: false,
    // who connected: the name and colour the editor sends (lib/collab/collab-client); `by` when the name is to be
    // credited with what they write (a server — on the person's own laptop writes stay "person", as before)
    async onConnect({ requestParameters, context }) {
      const c = context as { name?: string; by?: boolean };
      c.name = (requestParameters.get('name') ?? '').trim().slice(0, 60) || 'Someone'; c.by = requestParameters.get('by') === '1';
    },
    async onChange({ documentName, context }) {
      const c = context as { name?: string; by?: boolean } | undefined;
      if (c?.by && c.name) live.get(documentName)?.editors.add(c.name);
    },
    async onLoadDocument({ documentName, document }) {
      try { return await load(documentName, document as unknown as Y.Doc); }
      catch (e) { console.error(`wye collab: could not load ${documentName}: ${(e as Error).message}`); throw e; }
    },
    async onStoreDocument({ documentName, document }) {
      const p = live.get(documentName); if (!p) return;
      try { await storePage(p, document as unknown as Y.Doc); }
      catch (e) { console.error(`wye collab: could not store ${documentName}: ${(e as Error).message}`); }
    },
    async afterUnloadDocument({ documentName }) { live.delete(documentName); },
  });
  async function load(documentName: string, document: Y.Doc) {
      const hit = await locate(documentName); if (!hit) throw new Error(`no page ${documentName}`);
      const fileBody = bodyOf(await loadMarkdown(REPO_ROOT, hit.file));
      markdownToDoc(fileBody, document);
      live.set(documentName, { name: documentName, file: hit.file, productDir: hit.productDir, fileBody, stored: docToMarkdown(document), editors: new Set() });
      return document;
  }
  const wss = new WebSocketServer({ noServer: true });
  const collab: Collab = {
    hocuspocus, live, upgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => hocuspocus.handleConnection(ws as never, req)),
    // a page file written by anything in this app: merged into its live document when the page is live
    written(file, text) {
      const real = realOf(file);
      for (const p of live.values()) {
        if (realOf(path.join(REPO_ROOT, p.file)) !== real) continue;
        const doc = hocuspocus.documents.get(p.name); if (!doc) continue;
        try { mergeFile(p, doc as unknown as Y.Doc, bodyOf(text)); } catch (e) { console.error(`wye collab: could not merge a write into ${p.file}: ${(e as Error).message}`); }
      }
    },
    changedOnDisk(file) {
      const real = realOf(file);
      for (const p of live.values()) {
        const abs = path.join(REPO_ROOT, p.file); if (realOf(abs) !== real) continue;
        const doc = hocuspocus.documents.get(p.name); if (!doc) continue;
        void withFileLock(abs, async () => { mergeFile(p, doc as unknown as Y.Doc, bodyOf(await loadMarkdown(REPO_ROOT, p.file))); })
          .catch(e => console.error(`wye collab: could not merge ${p.file} from disk: ${(e as Error).message}`));
      }
    },
  };
  g.__wyeCollab = collab;
  // a server that stops stores what its live pages hold first: the last 2 s of typing are not lost on a restart
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { flushLive().finally(() => process.exit(0)); });
  return collab;
}
// every live page stored now, whatever the debounce — before the server stops or restarts (lib/agent-host)
export async function flushLive(): Promise<void> {
  const c = g.__wyeCollab; if (!c) return;
  await Promise.all([...c.hocuspocus.documents].map(async ([name, doc]) => { const p = c.live.get(name); if (p) await storePage(p, doc as unknown as Y.Doc).catch(e => console.error(`wye collab: could not store ${name}: ${(e as Error).message}`)); }));
}
export const collab = (): Collab | undefined => g.__wyeCollab;

// who is on which live page now: page ref → the people (name, colour) whose editors have it open
export function presence(): Record<string, { name: string; color: string }[]> {
  const c = g.__wyeCollab; const out: Record<string, { name: string; color: string }[]> = {}; if (!c) return out;
  for (const [name, doc] of c.hocuspocus.documents) {
    const people = [...doc.awareness.getStates().values()].map(st => (st as { user?: { name?: string; color?: string } }).user).filter((u): u is { name: string; color: string } => !!u?.name);
    if (people.length) out[name] = people.map(u => ({ name: u.name, color: u.color ?? '#888' }));
  }
  return out;
}

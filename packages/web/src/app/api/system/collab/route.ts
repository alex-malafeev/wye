import { NextResponse } from 'next/server';
import * as Y from 'yjs';
import { collab, storePage } from '@/lib/collab/collab-server';

// POST { name, update } — store a live page now (plan:collaboration): the editor's state (base64 Yjs update) is merged
// into the server's live document first, so the store holds every edit the editor made, then it is written and the
// graph rebuilt before the answer. → { ok, result: stored | same | shrunk }
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; update?: string };
  const c = collab(); const doc = b.name ? c?.hocuspocus.documents.get(b.name) : undefined; const page = b.name ? c?.live.get(b.name) : undefined;
  if (!doc || !page) return NextResponse.json({ ok: false, error: 'not_live' }, { status: 404 });
  if (b.update) Y.applyUpdate(doc as unknown as Y.Doc, Buffer.from(b.update, 'base64'));
  const result = await storePage(page, doc as unknown as Y.Doc);
  return NextResponse.json({ ok: result === 'stored' || result === 'same', result });
}

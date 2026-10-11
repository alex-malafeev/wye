import { NextResponse } from 'next/server';
import { loadScope } from '@/lib/scope';
import { readQuestion, startAnswerLibrarian } from '@/lib/question-answer';

// POST { id, answer } — the answer is already written under the question (Review's Answer); a librarian takes it and
// updates the decision the question settles, then resolves the question (req:waterfall.card-quality.answer-updates-decision).
// 503 when no librarian could start: the caller resolves the question itself, as before.
export async function POST(req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const scope = await loadScope(product); if (!scope) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { id, answer } = (await req.json().catch(() => ({}))) as { id?: string; answer?: string };
  const q = id ? readQuestion(scope.idx, id) : null;
  if (!q) return NextResponse.json({ error: 'not_found', message: `${id} is not a question of this product` }, { status: 404 });
  if (!answer?.trim()) return NextResponse.json({ error: 'invalid', message: 'answer it' }, { status: 422 });
  try { return NextResponse.json({ ok: true, ...(await startAnswerLibrarian(scope.product, product, q, answer.trim(), new URL(req.url).origin)) }); }
  catch (e) { return NextResponse.json({ error: 'unavailable', message: `the librarian could not start: ${e instanceof Error ? e.message : String(e)}` }, { status: 503 }); }
}

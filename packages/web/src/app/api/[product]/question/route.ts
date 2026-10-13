import { NextResponse } from 'next/server';
import { loadScope } from '@/lib/scope';
import { readQuestion, startAnswerLibrarian } from '@/lib/question-answer';
import { askedBy, sendAnswerBack } from '@/lib/vault-links';

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
  // a question another vault asked: the answer goes back to that vault's inbox as well (plan:vault-links)
  const asked = askedBy(scope.idx, q.id);
  const sentTo = asked ? await sendAnswerBack(scope.product.dir, product, q, asked, answer.trim()).catch(() => null) : null;
  if (asked) Object.assign(q, { why: `${q.why}\n(asked by the ${asked.by} vault${sentTo ? '; the answer was sent back to its inbox' : ', not on this machine — the answer was not sent back'})` });
  try { return NextResponse.json({ ok: true, ...(asked ? { sentBack: !!sentTo } : {}), ...(await startAnswerLibrarian(scope.product, product, q, answer.trim(), new URL(req.url).origin)) }); }
  catch (e) { return NextResponse.json({ error: 'unavailable', message: `the librarian could not start: ${e instanceof Error ? e.message : String(e)}` }, { status: 503 }); }
}

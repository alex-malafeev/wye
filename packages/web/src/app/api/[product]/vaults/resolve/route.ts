import { NextResponse } from 'next/server';
import { getProduct } from '@/lib/products';
import { openProduct } from '@/lib/product-transfer';
import { resolveLinked, LinkError } from '@/lib/vault-links';

// POST { name } | { address } → the other vault, looked up from this product's links on this machine — what wye ask
// --vault, wye request and wye request done|decline use, so they work from an agent on another machine (plan:vault-links)
export async function POST(req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params; const p = await getProduct(product); if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; address?: string };
  if (!b.name && b.address === undefined) return NextResponse.json({ error: 'invalid', message: 'name or address' }, { status: 400 });
  try { return NextResponse.json(await resolveLinked(p.dir, b, async f => (await openProduct(f)).slug)); }
  catch (e) {
    if (e instanceof LinkError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === 'no-path' ? 409 : 404 });
    return NextResponse.json({ error: 'open_failed', message: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}

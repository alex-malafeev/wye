import { NextResponse } from 'next/server';
import { getProduct } from '@/lib/products';
import { cacheInfo, clearAndRebuild } from '@/lib/cache';

export const dynamic = 'force-dynamic';

// GET → the product's cache, part by part, and whether it is being rebuilt (req:waterfall.cache-size.status-bar).
// POST → Clear and rebuild: the clearable parts are deleted and built again; answers with the cache as it is then.
export async function GET(_req: Request, { params }: { params: Promise<{ product: string }> }) {
  const p = await getProduct((await params).product);
  if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(await cacheInfo(p));
}
export async function POST(_req: Request, { params }: { params: Promise<{ product: string }> }) {
  const p = await getProduct((await params).product);
  if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await clearAndRebuild(p);
  return NextResponse.json(await cacheInfo(p));
}

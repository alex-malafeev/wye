import { NextResponse } from 'next/server';
import { getProduct } from '@/lib/products';
import { linkedVaults, changeLink } from '@/lib/vault-links';

// GET → { vaults } — the vault above, the ones below and the linked repos, with where each is on this machine (null for a
// product that is not a vault). POST { action: add | path | remove, url?, name?, path? } — as wye link (plan:vault-links).
export async function GET(_req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params; const p = await getProduct(product); if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ vaults: linkedVaults(p.dir) });
}
export async function POST(req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params; const p = await getProduct(product); if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try { changeLink(p.dir, await req.json()); } catch (e) { return NextResponse.json({ error: 'invalid', message: e instanceof Error ? e.message : String(e) }, { status: 422 }); }
  return NextResponse.json({ vaults: linkedVaults(p.dir) });
}

import { NextResponse } from 'next/server';
import { loadScope } from '@/lib/scope';
import { readCleanup, scanCleanup, applyCleanup } from '@/lib/cleanup';

// GET → the last cleanup list; POST { action: 'scan' } → a new one (judge calls: up to a few minutes on a large vault);
// POST { action: 'apply', ids } → the ticked cards dropped (req:waterfall.card-quality.cleanup)
export async function GET(_req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const scope = await loadScope(product); if (!scope) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ cleanup: await readCleanup(scope.product.dir) });
}
export async function POST(req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const scope = await loadScope(product); if (!scope) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; ids?: string[] };
  try {
    if (body.action === 'scan') return NextResponse.json({ cleanup: await scanCleanup(scope, m => console.log(m)) });
    if (body.action === 'apply') return NextResponse.json(await applyCleanup(scope, body.ids ?? []));
  } catch (e) { return NextResponse.json({ error: 'failed', message: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  return NextResponse.json({ error: 'invalid', message: "action is 'scan' or 'apply'" }, { status: 422 });
}

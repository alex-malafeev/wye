import { NextResponse } from 'next/server';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { loadScope } from '@/lib/scope';
import { bareSlug } from '@/lib/doc';
import { shippedStatus } from '@/lib/skills';
import { rebuild } from '@/lib/write';

// POST { project, slug } → Use the shipped version (req:waterfall.global-skills.override): the project's own copy of a
// shipped skill, workflow or hooks page is removed and the product rebuilt, so the page is read from the install again.
export async function POST(req: Request, { params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const scope = await loadScope(product); if (!scope) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { project?: string; slug?: string };
  const p = scope.projects.find(x => x.slug === b.project);
  if (!p || !b.slug) return NextResponse.json({ error: 'invalid', message: 'project and slug required' }, { status: 422 });
  const file = path.join(p.wyeDir, `${bareSlug(b.slug)}.md`);
  const st = await shippedStatus(scope.product.dir, file);
  if (st?.kind !== 'own') return NextResponse.json({ error: 'invalid', message: 'not a copy of a page Wye ships' }, { status: 422 });
  await rm(file, { force: true });
  await rebuild(scope.product.dir);
  return NextResponse.json({ ok: true });
}

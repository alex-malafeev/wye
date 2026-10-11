import { notFound } from 'next/navigation';
import { loadScope } from '@/lib/scope';
import { readCleanup } from '@/lib/cleanup';
import { CleanupList } from '@/components/CleanupList';

// The cleanup list (req:waterfall.card-quality.cleanup): requirements and decisions judged trivial or a copy of another
// card, each with the reason, dropped together once the person ticks them.
export default async function CleanupPage({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const scope = await loadScope(product); if (!scope) notFound();
  return (
    <div className="page page-wide">
      <header className="doc-head"><h1 className="prop-in h1" style={{ margin: 0 }}>Clean up</h1><p className="sub">requirements and decisions that are trivial — a cosmetic choice, a detail the code shows, a restatement — or say what another card says. Tick the ones to drop: a proposed card is rejected, an approved copy is superseded by the card it repeats.</p></header>
      <CleanupList product={product} initial={await readCleanup(scope.product.dir)} />
    </div>
  );
}

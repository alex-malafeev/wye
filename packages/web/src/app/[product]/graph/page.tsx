import { notFound } from 'next/navigation';
import { loadScope } from '@/lib/scope';
import { PRESETS, visibleSubgraph, type PresetName } from '@/lib/presets';
import { GraphView } from '@/components/GraphView';
import { HIDDEN_KINDS } from '@/lib/graph';
import { isSystemFile } from '@/lib/doc';
import { kindExample } from '@/lib/knowledge';
import { EmptyState } from '@/components/EmptyState';
import { EmptyAction } from '@/components/EmptyActions';

export default async function GraphPage({ params, searchParams }: { params: Promise<{ product: string }>; searchParams: Promise<{ focus?: string; preset?: string }> }) {
  const { product } = await params; const sp = await searchParams;
  const scope = await loadScope(product); if (!scope) notFound();
  const preset = (sp.preset && sp.preset in PRESETS ? sp.preset : 'Requirements') as PresetName;
  const focus = sp.focus ? decodeURIComponent(sp.focus) : null;
  const sub = visibleSubgraph(scope.graph, scope.idx, preset, focus);
  // a canvas of thousands of nodes cannot be read or laid out: without a focus only the best-connected are drawn, and the
  // page says so (a focused node's neighbourhood is small and drawn whole)
  const CAP = 250; const total = sub.nodes.length; const capped = !focus && total > CAP;
  let nodes = sub.nodes; let edges = sub.edges;
  if (capped) {
    const degree = new Map<string, number>(); for (const e of sub.edges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
    const keep = new Set([...sub.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, CAP).map(n => n.id));
    nodes = sub.nodes.filter(n => keep.has(n.id)); edges = sub.edges.filter(e => keep.has(e.from) && keep.has(e.to));
  }
  // an empty canvas says why: no block a person wrote yet (teach), or none of this preset's kinds (a filter)
  if (!nodes.length && !focus) {
    const blocks = scope.graph.nodes.some(n => n.defined && !HIDDEN_KINDS.has(n.kind) && n.kind !== 'module' && n.kind !== 'type' && !isSystemFile(n.file));
    return (
      <div className="page">{blocks
        ? <p className="muted">Nothing in the {preset} view. <a href={`/${product}/graph?preset=Everything`}>Everything →</a></p>
        : <EmptyState icon="⌬" title="No graph yet" actions={<EmptyAction act="new-page">New document</EmptyAction>}>
            <p>The graph draws the blocks and the links between them. It appears once a document has blocks with ids that refer to each other:</p>
            <p><code>{kindExample('test')}</code></p>
          </EmptyState>}
      </div>
    );
  }
  const note = capped ? <p className="muted small" style={{ padding: '6px 14px' }}>Showing the {CAP} best-connected of {total} blocks — open a block in the column and choose Graph to see its neighbourhood, or narrow the view.</p> : null;
  return <>{note}<GraphView product={product} preset={preset} focus={focus} nodes={nodes.map(n => ({ id: n.id, kind: n.kind, title: n.title, status: n.status, defined: n.defined }))} edges={edges} /></>;
}

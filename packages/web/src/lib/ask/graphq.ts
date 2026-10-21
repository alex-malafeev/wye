// Ask's graph step (decision:waterfall.ask-queries-the-graph): between the search and the two answer lanes, the
// question is read for the graph's own entities, a planner turns it into a few graph queries, a second round follows
// up on what they found, and the nodes they reach join the search hits for the reranker. Internal to Ask — no command
// or API takes a graph query; a person or an agent asks a question and nothing else.
//   entities  names and aliases of the graph's nodes said in the question (deterministic)
//   queries   start at nodes, walk their links (both ways, any verb unless named), keep nodes of a kind, in a time
//             window, with words; a node linked to several of the starts ranks first (an association)
//   planner   one tool-less model call per round (WYE_ASK_PLAN_MODEL, else haiku); without it, or when it fails, the
//             entities' neighbourhoods and their common neighbours are queried anyway
import type { GraphIndex, GraphNode } from '../graph';
import { HIDDEN_KINDS, isCurrent } from '../graph';
import { cardValue } from '../hooks';
import { spawnClaude } from './claude';

export const PLAN_MODEL = process.env.WYE_ASK_PLAN_MODEL || 'claude-haiku-5-5';
const TIME_KEYS = ['date', 'starts', 'ends', 'since', 'until', 'due'];
// kinds that are the vault's machinery, not what it knows about
const NOT_ENTITIES = new Set(['type', 'module', 'skill', 'hook', 'task', 'step', 'workflow', 'stage', 'agent', 'project', 'product', 'comment', 'text']);

export interface GraphQuery { from?: string[]; via?: string[]; kind?: string[]; when?: { from?: string; to?: string }; words?: string; hops?: number; why?: string }
export interface Found { id: string; score: number; why: string }

const usable = (n: GraphNode | undefined): n is GraphNode => !!n && !HIDDEN_KINDS.has(n.kind) && !n.archived && isCurrent(n);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const listOf = (v: string) => v.replace(/^\[|\]$/g, '').split(/[,\n]/).map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

// the time a node carries, as [start, end] strings (a year or a month compares as its first day by string order)
export function timeOf(n: GraphNode): [string, string] | null {
  const v: Record<string, string> = {};
  for (const k of TIME_KEYS) { const x = cardValue(n.body, k) || (k === 'since' ? n.since ?? '' : k === 'until' ? n.until ?? '' : ''); if (/^\d{4}/.test(x)) v[k] = x.slice(0, 10); }
  const start = v.date || v.starts || v.since || v.due || v.ends || v.until; if (!start) return null;
  return [start, v.ends || v.until || v.date || start];
}
const inWindow = (t: [string, string] | null, w: { from?: string; to?: string }) => !!t && (!w.from || t[1] + '￿' >= w.from) && (!w.to || t[0] <= w.to + '￿');

// the graph's entities named in the question: a title or an alias said as whole words
export function entitiesIn(q: string, idx: GraphIndex, max = 8): string[] {
  const text = ` ${norm(q)} `; const out: { id: string; len: number }[] = [];
  for (const n of idx.byId.values()) {
    if (!usable(n) || NOT_ENTITIES.has(n.kind) || !n.title) continue;
    const names = [n.title, ...listOf(cardValue(n.body, 'aliases'))].map(norm).filter(s => s.length >= 3 && s.split(' ').length <= 5);
    const hit = names.find(s => text.includes(` ${s} `));
    if (hit) out.push({ id: n.id, len: hit.length });
  }
  // the longest names first: "Melanie's daughter" before "Melanie" — and things before statements about them
  return out.sort((a, b) => b.len - a.len).slice(0, max).map(x => x.id);
}

// one query over the index: the nodes it reaches, best first
export function runQuery(idx: GraphIndex, g: GraphQuery, cap = 40): Found[] {
  const why = g.why || describe(g);
  const words = g.words ? norm(g.words).split(' ').filter(w => w.length > 2) : [];
  const keep = (n: GraphNode) => usable(n) && (!g.kind?.length || g.kind.includes(n.kind)) && (!g.when || inWindow(timeOf(n), g.when))
    && (!words.length || words.some(w => norm(`${n.title} ${n.body}`).includes(w)));
  const starts = (g.from ?? []).filter(id => idx.byId.has(id));
  const score = new Map<string, number>();
  if (!starts.length) {
    for (const n of idx.byId.values()) if (keep(n)) score.set(n.id, 1);
  } else {
    const hops = Math.min(2, Math.max(1, g.hops ?? 1));
    for (const s of starts) {
      // each start's reach counted once, so a node several starts reach ranks by how many
      const seen = new Set<string>([s]); let front = [s];
      for (let h = 1; h <= hops; h++) {
        const next: string[] = [];
        for (const id of front) for (const e of [...(idx.out.get(id) ?? []), ...(idx.inc.get(id) ?? [])]) {
          if (g.via?.length && !g.via.includes(e.verb)) continue;
          const o = e.from === id ? e.to : e.from; if (seen.has(o)) continue; seen.add(o); next.push(o);
          const n = idx.byId.get(o); if (n && keep(n)) score.set(o, (score.get(o) ?? 0) + (h === 1 ? 1 : 0.5));
        }
        front = next;
      }
    }
    for (const s of starts) { const n = idx.byId.get(s); if (n && keep(n) && !score.has(s)) score.set(s, 0.75); }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (timeOf(idx.byId.get(a[0])!)?.[0] ?? '').localeCompare(timeOf(idx.byId.get(b[0])!)?.[0] ?? ''))
    .slice(0, cap).map(([id, s]) => ({ id, score: s, why }));
}
function describe(g: GraphQuery): string {
  return [g.kind?.length ? g.kind.join('|') : 'nodes', g.from?.length ? `linked to ${g.from.join(', ')}` : '', g.via?.length ? `via ${g.via.join('|')}` : '',
    g.when ? `in ${g.when.from ?? '…'}..${g.when.to ?? '…'}` : '', g.words ? `with "${g.words}"` : ''].filter(Boolean).join(' ');
}

// what the planner is told about the graph: its kinds, its link verbs and the time it covers
export function graphSummary(idx: GraphIndex): string {
  const kinds = new Map<string, number>(), verbs = new Map<string, number>(); let lo = '', hi = '';
  for (const n of idx.byId.values()) { if (!usable(n) || NOT_ENTITIES.has(n.kind)) continue; kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1); const t = timeOf(n); if (t) { if (!lo || t[0] < lo) lo = t[0]; if (!hi || t[1] > hi) hi = t[1]; } }
  for (const es of idx.out.values()) for (const e of es) if (!e.generated) verbs.set(e.verb, (verbs.get(e.verb) ?? 0) + 1);
  const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, c]) => `${x} (${c})`).join(', ');
  return `kinds: ${top(kinds, 25)}\nlinks: ${top(verbs, 25)}${lo ? `\ntime covered: ${lo} .. ${hi}` : ''}`;
}

const nodeLine = (idx: GraphIndex, id: string) => { const n = idx.byId.get(id)!; const t = timeOf(n); return `- ${id} (${n.kind}${t ? `, ${t[0] === t[1] ? t[0] : `${t[0]}..${t[1]}`}` : ''}) ${n.title}`.slice(0, 220); };

export function planPrompt(q: string, idx: GraphIndex, entities: string[], seen: string[], round: 1 | 2): string {
  return `You turn a question into queries over a knowledge graph. Reply with JSON only: {"queries":[…]}, at most ${round === 1 ? 4 : 3} queries, [] when nothing more is worth looking up.
A query: {"from":[node ids to start at], "via":[link verbs to follow; leave out for any], "kind":[node kinds to keep], "when":{"from":"YYYY[-MM[-DD]]","to":"YYYY[-MM[-DD]]"}, "words":"words the node must contain (any of them)", "hops":1|2, "why":"what it looks for"}.
Every field is optional; "from" with "hops":2 finds what two things have in common or what is two links away. Use only ids, kinds and verbs that exist below.
${round === 1 ? 'Look for what the question needs: the entities it names, the kind of thing it asks about (when → dated nodes, who → people), the time it is about.' : 'These nodes were found so far. Ask only for what is still missing to answer: a related entity they point to, the events around a date they give, the other side of a link.'}

## The graph
${graphSummary(idx)}

## Entities named in the question
${entities.length ? entities.map(id => nodeLine(idx, id)).join('\n') : '(none matched by name)'}
${seen.length ? `\n## ${round === 1 ? 'What a text search found' : 'Found so far'}\n${seen.slice(0, 30).map(id => nodeLine(idx, id)).join('\n')}\n` : ''}
## Question
${q}`;
}

export function parsePlan(text: string): GraphQuery[] {
  const m = text.match(/\{[\s\S]*\}/); if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { queries?: unknown };
    return (Array.isArray(j.queries) ? j.queries : []).filter((x): x is GraphQuery => !!x && typeof x === 'object').slice(0, 4).map(g => ({
      from: Array.isArray(g.from) ? g.from.map(String).slice(0, 8) : undefined, via: Array.isArray(g.via) ? g.via.map(String) : undefined,
      kind: Array.isArray(g.kind) ? g.kind.map(String) : undefined, when: g.when && typeof g.when === 'object' ? { from: g.when.from ? String(g.when.from) : undefined, to: g.when.to ? String(g.when.to) : undefined } : undefined,
      words: g.words ? String(g.words) : undefined, hops: g.hops ? Number(g.hops) : undefined, why: g.why ? String(g.why).slice(0, 120) : undefined,
    }));
  } catch { return []; }
}

async function plan(prompt: string, o: { signal: AbortSignal; timeoutMs?: number }): Promise<GraphQuery[]> {
  let text = '';
  for await (const l of spawnClaude(['-p', '--output-format', 'json', '--model', PLAN_MODEL, '--tools', ''], prompt, { signal: o.signal, timeoutMs: o.timeoutMs ?? 30000 })) if (l.type === 'result' && typeof l.result === 'string') text = l.result;
  return parsePlan(text);
}

// The whole step: the nodes the graph adds to what the search found, best first, each with why it was reached.
// `seen` are the node ids the search already has; `planner: false` keeps to the deterministic queries (tests, no model).
export async function graphFind(idx: GraphIndex, q: string, seen: string[], o: { signal: AbortSignal; planner?: boolean; onStep?: (t: string) => void; cap?: number }): Promise<Found[]> {
  const entities = entitiesIn(q, idx);
  const found = new Map<string, Found>();
  const add = (fs: Found[]) => { for (const f of fs) { const was = found.get(f.id); if (!was || was.score < f.score) found.set(f.id, f); } };
  // always: each entity's neighbourhood, and what the entities share
  for (const id of entities) add(runQuery(idx, { from: [id], hops: 1, why: `linked to ${id}` }, 25));
  if (entities.length > 1) add(runQuery(idx, { from: entities, hops: 2, why: `linked to ${entities.join(' and ')}` }, 25).filter(f => f.score >= 1.5).map(f => ({ ...f, score: f.score + 1 })));
  if (o.planner !== false && !o.signal.aborted) {
    try {
      const first = await plan(planPrompt(q, idx, entities, seen.filter(id => idx.byId.has(id)), 1), o);
      for (const g of first) { o.onStep?.(`Graph: ${g.why || describe(g)}`); add(runQuery(idx, g, 25).map(f => ({ ...f, score: f.score + 0.5 }))); }
      if (first.length && found.size && !o.signal.aborted) {
        const so = [...found.values()].sort((a, b) => b.score - a.score).map(f => f.id);
        const more = await plan(planPrompt(q, idx, entities, so, 2), o);
        for (const g of more) { o.onStep?.(`Graph: ${g.why || describe(g)}`); add(runQuery(idx, g, 20).map(f => ({ ...f, score: f.score + 0.25 }))); }
      }
    } catch { /* the planner is a help, not a requirement: the entity queries stand */ }
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, o.cap ?? 40);
}

// the graph's findings as the deep lane reads them: one line a node, with why the graph reached it
export function graphNote(idx: GraphIndex, found: Found[], max = 25): string {
  return found.filter(f => idx.byId.has(f.id)).slice(0, max).map(f => `${nodeLine(idx, f.id)} — ${f.why}`).join('\n');
}

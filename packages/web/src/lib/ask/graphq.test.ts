import { describe, it, expect } from 'vitest';
import type { GraphIndex, GraphNode, GraphEdge } from '../graph';
import { entitiesIn, runQuery, parsePlan, timeOf, graphFind, graphSummary } from './graphq';

function index(nodes: Partial<GraphNode>[], edges: [string, string, string][]): GraphIndex {
  const byId = new Map<string, GraphNode>(), out = new Map<string, GraphEdge[]>(), inc = new Map<string, GraphEdge[]>();
  for (const n of nodes) byId.set(n.id!, { kind: n.id!.split(':')[0], title: '', status: 'proposed', section: '', subsection: '', body: '', defined: true, file: 'x.md', line: 1, ...n } as GraphNode);
  for (const [from, verb, to] of edges) { const e = { from, verb, to }; out.set(from, [...(out.get(from) ?? []), e]); inc.set(to, [...(inc.get(to) ?? []), e]); }
  return { byId, out, inc };
}

const idx = index([
  { id: 'person:caroline', title: 'Caroline' },
  { id: 'person:melanie', title: 'Melanie', body: 'aliases: [Mel]' },
  { id: 'event:race', title: 'Melanie ran a charity race for mental health', body: 'date: 2023-05-20' },
  { id: 'event:pride', title: 'Caroline and Melanie went to the pride parade', body: 'date: 2023-07' },
  { id: 'fact:painting', title: 'Melanie painted a lake sunrise', body: 'date: 2022' },
  { id: 'fact:old', title: 'Melanie lived in Ohio', status: 'superseded' },
  { id: 'type:event', title: 'event' },
], [
  ['event:race', 'participants', 'person:melanie'],
  ['event:pride', 'participants', 'person:melanie'],
  ['event:pride', 'participants', 'person:caroline'],
  ['fact:painting', 'about', 'person:melanie'],
  ['fact:old', 'about', 'person:melanie'],
]);

describe('the graph step of Ask', () => {
  it('finds the entities a question names, by title or alias, never the machinery', () => {
    expect(entitiesIn('When did Mel run the race?', idx)).toEqual(['person:melanie']);
    expect(entitiesIn('What did Caroline and Melanie do together?', idx).sort()).toEqual(['person:caroline', 'person:melanie']);
    expect(entitiesIn('which event?', idx)).toEqual([]);
  });
  it('reads a node\'s time to the precision it has', () => {
    expect(timeOf(idx.byId.get('event:race')!)).toEqual(['2023-05-20', '2023-05-20']);
    expect(timeOf(idx.byId.get('fact:painting')!)).toEqual(['2022', '2022']);
    expect(timeOf(idx.byId.get('person:melanie')!)).toBeNull();
  });
  it('walks links both ways and keeps a kind, a time window and current nodes', () => {
    expect(runQuery(idx, { from: ['person:melanie'], kind: ['event'] }).map(f => f.id).sort()).toEqual(['event:pride', 'event:race']);
    expect(runQuery(idx, { from: ['person:melanie'], when: { from: '2023-06', to: '2023-12' } }).map(f => f.id)).toEqual(['event:pride']);
    expect(runQuery(idx, { from: ['person:melanie'], when: { from: '2022', to: '2022' } }).map(f => f.id)).toEqual(['fact:painting']);
    expect(runQuery(idx, { from: ['person:melanie'] }).map(f => f.id)).not.toContain('fact:old');
    expect(runQuery(idx, { kind: ['event'], words: 'charity' }).map(f => f.id)).toEqual(['event:race']);
  });
  it('ranks first what several starts share — an association', () => {
    expect(runQuery(idx, { from: ['person:melanie', 'person:caroline'] })[0].id).toBe('event:pride');
  });
  it('reads the planner\'s queries and drops what is not a query', () => {
    expect(parsePlan('Here: {"queries":[{"from":["person:melanie"],"kind":["event"],"when":{"from":"2023"},"why":"her events"}, 3]}')).toEqual([{ from: ['person:melanie'], kind: ['event'], when: { from: '2023', to: undefined }, via: undefined, words: undefined, hops: undefined, why: 'her events' }]);
    expect(parsePlan('no json')).toEqual([]);
  });
  it('without a planner still brings the named entities\' links', async () => {
    const found = await graphFind(idx, 'What did Caroline and Melanie do together?', [], { signal: new AbortController().signal, planner: false });
    expect(found[0].id).toBe('event:pride');
    expect(found.map(f => f.id)).toContain('event:race');
  });
  it('tells the planner the graph\'s kinds, links and time', () => {
    const s = graphSummary(idx);
    expect(s).toMatch(/event \(2\)/); expect(s).toMatch(/participants \(3\)/); expect(s).toMatch(/time covered: 2022 \.\. 2023-07/);
    expect(s).not.toMatch(/type \(/);
  });
});

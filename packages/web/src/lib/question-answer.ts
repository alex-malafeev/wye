// An answered question updates its decision (decision:waterfall.question-answer-updates-its-decision,
// req:waterfall.card-quality.answer-updates-decision): the answer is written under the question, and a librarian takes
// the question, why it was asked, what it was said to change and the decision it settles, and brings the knowledge in
// line — refines a proposed decision, supersedes an approved one, writes the first decision when `decides:` names a
// requirement — then resolves the question.
import { REPO_ROOT, type Product } from './products';
import { parseBody, type GraphIndex } from './graph';
import { createSession } from './sessions';
import { startChat } from './agent-host';
import { agentSettings, readSettings } from './settings';

export interface AnsweredQuestion { id: string; title: string; q: string; why: string; changes: string; decides: { id: string; kind: string; status: string; title: string }[] }

const ids = (v: string) => v.replace(/[[\]]/g, '').split(/[,\s]+/).filter(x => /^[a-z-]+:[\w.-]+$/.test(x));

export function readQuestion(idx: Pick<GraphIndex, 'byId'>, id: string): AnsweredQuestion | null {
  const n = idx.byId.get(id); if (!n?.defined || n.kind !== 'question') return null;
  const rows = parseBody(n.body ?? ''); const get = (k: string) => rows.find(r => r.key === k)?.value?.trim() ?? '';
  const decides = ids(get('decides')).map(d => { const x = idx.byId.get(d); return { id: d, kind: x?.kind ?? '?', status: x?.status ?? '', title: x?.title ?? '' }; });
  return { id, title: n.title ?? id, q: get('q'), why: get('why'), changes: get('answer-changes'), decides };
}

export function answerBrief(q: AnsweredQuestion, answer: string, date: string): string {
  const said = (label: string, v: string) => v ? `${label}: ${v}` : `${label}: (not said — the question predates the field)`;
  const dec = q.decides.length ? q.decides.map(d => `- ${d.id} [${d.kind}, ${d.status || 'no status'}] ${d.title}`).join('\n') : '- (none named — find the decision on this choice with wye context; if there is none, the answer writes the first one)';
  return `The person answered ${q.id} — "${q.q || q.title}".

${said('Why it was asked', q.why)}
${said('What the answer was said to change', q.changes)}
What it decides:
${dec}

The answer, in the person's words (already written under the question):

${answer}

Bring the knowledge in line with the answer, then resolve the question:
- Each decision it decides: still proposed → refine it in place (wye node content / wye node set) so it states what was chosen and what was ruled out; approved → propose a new decision that \`supersedes:\` it. A requirement, constraint or rule in decides (no decision yet) → propose the decision, \`affects:\` that block. Every decision you write or refine carries \`resolves: [${q.id}]\` and \`evidence: ${q.id}, answered by the person on ${date}\`.
- Carry the change through the blocks the answer changes: a requirement or test whose text it overrules is refined (proposed) or superseded (approved) — never left saying what the answer ruled out.
- One choice, one decision: never a second decision for a choice that already has one, and nothing the answer does not change.
- Then \`wye node set ${q.id} --status resolved\` and end with one line per block you changed.
If the answer does not settle it — it asks back, or says to skip — change nothing, leave the question open and say why.`;
}

// the librarian on the harness Settings › Agents names, as the inbox digest starts one
export async function startAnswerLibrarian(p: Product, product: string, q: AnsweredQuestion, answer: string, wfUrl: string): Promise<{ session: string }> {
  const refs = [q.id, ...q.decides.map(d => d.id), ...ids(q.changes)];
  const s = await createSession(p.dir, product, { agent: agentSettings(await readSettings()).librarian, instruction: answerBrief(q, answer, new Date().toISOString().slice(0, 10)), refs, source: { text: `answer to ${q.id}` }, mode: 'chat', cwd: REPO_ROOT, role: 'librarian', hooks: [] });
  const started = await startChat(p.dir, product, s.id, { wfUrl });
  return { session: (started ?? s).id };
}

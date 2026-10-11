// Raw input in the inbox (decision:waterfall.raw-input-stays-raw, decision:waterfall.raw-request-to-inbox-then-digest):
// the person's words from `wye remember`, their impact on what is known judged on arrival, and the digest — a Remember
// conversation told that the input is a request, not knowledge. Shared by the inbox routes (arrival, Digest again).
import { REPO_ROOT, type Product } from './products';
import { digestInboxItem, impactInboxItem, type InboxImpact } from './inbox';
import { rawInputJudge } from './impact-run';
import { loadScope } from './scope';
import { createSession } from './sessions';
import { startChat } from './agent-host';
import { agentSettings, readSettings } from './settings';
import { markStep } from './onboarding-io';

export async function judgeRawImpact(productDir: string, product: string, name: string): Promise<InboxImpact | null> {
  try { const scope = await loadScope(product); if (!scope) return null; return await impactInboxItem(productDir, scope.graph, name, { judge: await rawInputJudge(productDir) }); }
  catch (e) { console.warn('inbox: impact failed —', e instanceof Error ? e.message : e); return null; }
}

// stored by an agent with `wye remember` (the CLI marks it `agent` / `agent session <id>`), not by the person in the app
export const fromAgent = (from: string | undefined) => /^agent\b/.test(from ?? '');

// the digest's brief: raw input is a request or a remark, not a statement of what the product does — the librarian files
// what it states that is new, supersedes what it changes, raises what it contradicts, and never restates it as blocks
export function rawBrief(name: string, from: string | undefined, text: string, impact: InboxImpact | null): string {
  const lines = impact?.candidates.length ? impact.candidates.map(c => `- ${c.id} — ${c.verdict}: ${c.question ?? c.reason}`) : [impact ? '- nothing judged as affected among the closest knowledge' : '- not judged'];
  // one writer (req:waterfall.card-quality.one-writer): words an agent stored with `wye remember` are filed by that agent —
  // it writes the decisions it makes — so the digest only brings what they change or contradict into line
  if (fromAgent(from)) return `Raw input from ${from}, kept in the inbox as ${name}: the person's words, stored by the agent working on them. That agent files the decisions, requirements and facts that come of it — so propose no new block for it, not even one that looks missing. Only bring into line what the words change in what is known: refine (proposed) or supersede (approved) a block they overrule, and raise what they contradict as an open question. When nothing known is changed or contradicted, change nothing and say so in one line. Impact judged on arrival against what is known:\n${lines.join('\n')}\n\nThe input:\n\n${text}`;
  return `Raw input${from ? ` from ${from}` : ''}, kept in the inbox as ${name}. It is a request or a remark in the person's own words — not a statement of what the product does, so do not restate it as req: blocks or as a decision the person did not make. File only what it states that is new (a fact, a decision the person made, a constraint they set), refine or supersede what it changes, raise what it contradicts as an open question, and leave the rest. Impact judged on arrival against what is known:\n${lines.join('\n')}\n\nThe input:\n\n${text}`;
}

// a Remember conversation as the command box starts one — a librarian on the harness Settings › Agents names, in the Wye folder
export async function digestRaw(p: Product, product: string, name: string, impact: InboxImpact | null, wfUrl: string): Promise<{ session: string | null; error?: string }> {
  return digestInboxItem(p.dir, name, async o => {
    const s = await createSession(p.dir, product, { agent: agentSettings(await readSettings()).librarian, instruction: rawBrief(name, o.source.from, o.instruction, impact), refs: o.refs.slice(0, 50), source: o.source, mode: 'chat', cwd: REPO_ROOT, role: 'librarian', skills: fromAgent(o.source.from) ? [] : ['skill:remember'], hooks: [] });
    void markStep(p.slug, 'remember');
    const started = await startChat(p.dir, product, s.id, { wfUrl });
    return { id: (started ?? s).id };
  });
}

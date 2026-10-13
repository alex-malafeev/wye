// One proposed card for op:api.propose (req:exec.wye-proposes): checked and normalised before it is written, and placed
// where it belongs. Wye cards are not strict yaml (a title may hold a colon), so the check is of shape: one card, keys
// at one indentation, no key twice — the shapes an agent's edit-by-repropose produced (a second card nested in the
// first, an old and a new title side by side) are refused with the reason, not written.
export function parseCard(raw: string): { id: string; block: string } | { error: string } {
  const card = raw.replace(/^```ya?ml\s*\n|\n```\s*$/g, '').replace(/\s+$/, '').replace(/^\s*\n/, '');
  const lines = card.split('\n');
  const idm = lines[0].match(/^\s*-?\s*id:\s*([a-z-]+:[A-Za-z0-9_.\-]+)\s*$/);
  if (!idm) return { error: 'the card must start with `- id: kind:slug`' };
  const rest = lines.slice(1).filter(l => l.trim());
  const ind = (l: string) => l.match(/^\s*/)![0].length;
  const key = rest.length ? ind(rest[0]) : 0;
  const seen = new Set<string>();
  for (const l of rest) {
    const n = ind(l); const t = l.trim();
    if (n < key || (n === key && key === 0 && t.startsWith('- '))) return t.startsWith('- ') && /^-\s*id:/.test(t) ? { error: 'one card per propose — this text holds a second card; propose it on its own' } : { error: `the indentation drops below the card's keys at "${t.slice(0, 40)}" — keep every key at one indentation` };
    if (/^-?\s*id:\s/.test(t)) return { error: 'one card per propose — this text holds a second card; propose it on its own (to change a card, use wye node set / wye node content)' };
    if (n !== key) continue;
    if (t.startsWith('- ')) return { error: 'one card per propose — a list item sits at the level of the card\'s keys' };
    const k = t.match(/^([A-Za-z][\w-]*):/)?.[1];
    if (!k) return { error: `"${t.slice(0, 40)}" is not a key: value line` };
    if (seen.has(k)) return { error: `the key "${k}" is given twice — a card holds each key once (to change a card, use wye node set / wye node content)` };
    seen.add(k);
  }
  if (!seen.has('status')) return { error: 'the card needs a status (proposed, or open for a question)' };
  // the card as a list item: keys two deep, deeper lines keep their depth relative to the keys
  const block = [`- id: ${idm[1]}`, ...rest.map(l => `  ${l.slice(key)}`)].join('\n');
  return { id: idm[1], block };
}

// Where a card goes in a document: on a request page (it has a Definition) at the end of the Definition — never at the
// end of the file, which is the Result the app rewrites when the build ends; anywhere else at the end.
export function placeCard(md: string, fence: string): string {
  const m = md.match(/^## Definition[^\n]*\n/m);
  if (!m || m.index === undefined) return `${md.replace(/\s+$/, '')}\n\n${fence}\n`;
  const start = m.index + m[0].length; const after = md.slice(start); const n = after.search(/^## /m);
  const end = n === -1 ? md.length : start + n;
  return `${md.slice(0, start)}${md.slice(start, end).replace(/\s+$/, '')}\n\n${fence}\n${n === -1 ? '' : '\n'}${md.slice(end)}`;
}

// A card's top-level keys and their values: a `|` / `>` value is its deeper lines joined, a list value its items
// joined by ", " (decides: [a, b] and decides:\n  - a read the same).
export function cardKeys(block: string): Record<string, string> {
  const out: Record<string, string> = {}; let cur = ''; const more: string[] = [];
  const flush = () => { if (cur && more.length) out[cur] = (out[cur] ? `${out[cur]} ` : '') + more.map(l => l.replace(/^-\s+/, '')).join(out[cur] === undefined || /^[|>]/.test(out[cur]) ? ' ' : ', '); more.length = 0; };
  for (const l of block.split('\n').slice(1)) {
    const m = l.match(/^ {2}([A-Za-z][\w-]*):\s*(.*)$/);
    if (m) { flush(); cur = m[1]; out[cur] = m[2].trim(); continue; }
    if (cur && l.trim()) more.push(l.trim());
  }
  flush();
  for (const k of Object.keys(out)) out[k] = out[k].replace(/^[|>][-+]?\s*/, '').trim();
  return out;
}

// What a question must say (constraint:waterfall.question-says-why-and-what-the-answer-changes,
// decision:waterfall.question-fields-why-answer-changes-decides): why it is asked, what each answer changes, and the
// decision it settles — or, before one exists, the requirement, constraint or rule the choice belongs to
// (decision:waterfall.decides-names-a-decision-or-what-it-decides-for). null when it says all three.
export const QUESTION_FIELDS = { why: 'what is blocked or waiting on the answer', 'answer-changes': 'what each likely answer changes, naming the blocks or work', decides: 'the id of the decision the answer settles or changes (or, before one exists, the req / constraint / rule it decides for)' } as const;
const DECIDES_KINDS = new Set(['decision', 'req', 'constraint', 'rule', 'fact']);
export function questionProblem(block: string, kindOf: (id: string) => string | undefined): string | null {
  const k = cardKeys(block);
  // a question another vault asked (asked-by:, plan:vault-links) decides something in that vault, not in this one:
  // `decides:` is optional and its ids are not looked up here
  const asked = !!k['asked-by']?.trim();
  const missing = Object.entries(QUESTION_FIELDS).filter(([f]) => !(asked && f === 'decides') && !k[f]?.replace(/[[\]\s]/g, ''));
  if (missing.length) return `a question says why it is asked and what its answer changes — add ${missing.map(([f, what]) => `\`${f}:\` (${what})`).join(', ')}`;
  if (asked) return null;
  for (const id of k.decides.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean)) {
    const kind = kindOf(id);
    if (!kind) return `decides: ${id} is not in the vault — name the decision the answer settles, or the req / constraint / rule it decides for`;
    if (!DECIDES_KINDS.has(kind)) return `decides: ${id} is a ${kind} — name a decision, or the req / constraint / rule / fact the choice belongs to`;
  }
  return null;
}

// A card that says what one in the vault already says (req:waterfall.card-quality.no-duplicates): ranked against the
// closest knowledge cards by the vault's semantic + keyword search, it is refused at DUP_REFUSE — the copies found in
// the waterfall vault scored 0.76–0.86, distinct cards on the same topic below 0.55 — and named as close from DUP_NEAR,
// where a copy and a neighbour both fall. A card that supersedes, refines or resolves the hit is a change, not a copy.
export const DUP_REFUSE = 0.75, DUP_NEAR = 0.62;
const KNOWLEDGE = new Set(['req', 'decision', 'constraint', 'rule', 'fact', 'question', 'goal', 'lesson']);
export const isKnowledgeCard = (id: string) => KNOWLEDGE.has(id.split(':')[0]);
export const cardQuery = (k: Record<string, string>) => [k.title, k.q, k.statement, k.text].filter(Boolean).join(' — ').slice(0, 1200);
export function duplicateOf(id: string, keys: Record<string, string>, hits: { id: string; score: number }[]): { copy?: { id: string; score: number }; near: { id: string; score: number }[] } {
  const named = new Set(['supersedes', 'refines', 'resolves'].flatMap(f => (keys[f] ?? '').replace(/[[\]]/g, '').split(/[,\s]+/)).filter(Boolean));
  // a question and the decision that answers it share their words: a question only counts against a new question
  const asks = id.startsWith('question:');
  const same = hits.filter(h => h.id !== id && isKnowledgeCard(h.id) && (asks || !h.id.startsWith('question:')) && !named.has(h.id) && h.score >= DUP_NEAR).map(h => ({ id: h.id, score: Math.round(h.score * 100) / 100 }));
  const copy = same.find(h => h.score >= DUP_REFUSE);
  return { ...(copy ? { copy } : {}), near: same.filter(h => h !== copy).slice(0, 3) };
}

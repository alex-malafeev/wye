// What goes back to the vault that asked (plan:vault-links): a question another vault asked carries `asked-by:` (its
// name) and `asked-from:` (how to reach it from here — a path inside one repo, else its repo URL, lib/links.js); when it
// is answered, the answer lands in the asking vault's inbox, if that vault is on this machine
// (decision:waterfall.cross-vault-question-answers-now-else-queues).
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, DATA_ROOT } from './products';
import { addInboxItem } from './inbox';
import { parseBody, type GraphIndex } from './graph';

const links = () => createRequire(path.join(REPO_ROOT, 'package.json'))('./lib/links.js') as { folderOf(base: string, address: string, home: string | null): string | null };

export function askedBy(idx: Pick<GraphIndex, 'byId'>, id: string): { by: string; from: string } | null {
  const n = idx.byId.get(id); if (!n) return null;
  const rows = parseBody(n.body ?? ''); const get = (k: string) => rows.find(r => r.key === k)?.value?.trim() ?? '';
  const by = get('asked-by'), from = get('asked-from');
  return by && from ? { by, from } : null;
}

// the vault folder an address names, seen from the vault whose .wye is `productDir` — null when it is not on this machine
export function vaultFolderOf(productDir: string, address: string): string | null {
  if (path.basename(productDir) !== '.wye') return null;   // only a vault beside its code has an address
  return links().folderOf(path.dirname(productDir), address, path.dirname(DATA_ROOT));
}

// the answer to a question another vault asked, into that vault's inbox → the item's name, or null when it is not here
export async function sendAnswerBack(productDir: string, fromVault: string, q: { id: string; title: string }, asked: { by: string; from: string }, answer: string): Promise<string | null> {
  const to = vaultFolderOf(productDir, asked.from); if (!to) return null;
  return addInboxItem(path.join(to, '.wye'), { type: 'note', title: `${fromVault} answered: ${q.title}`, text: answer, from: `vault ${fromVault}`, refs: [q.id], fields: { 'from-vault': fromVault, question: q.title } });
}

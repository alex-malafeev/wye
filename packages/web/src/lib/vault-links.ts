// What goes back to the vault that asked (plan:vault-links): a question another vault asked carries `asked-by:` (its
// name) and `asked-from:` (how to reach it from here — a path inside one repo, else its repo URL, lib/links.js); when it
// is answered, the answer lands in the asking vault's inbox, if that vault is on this machine
// (decision:waterfall.cross-vault-question-answers-now-else-queues).
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, DATA_ROOT } from './products';
import { addInboxItem } from './inbox';
import { existsSync } from 'node:fs';
import { parseBody, type GraphIndex } from './graph';

export interface LinkedVault { name: string; kind: 'parent' | 'child' | 'repo'; folder: string | null; repo?: string; via?: string | null; slug: string | null }
const links = () => createRequire(path.join(REPO_ROOT, 'package.json'))('./lib/links.js') as {
  folderOf(base: string, address: string, home: string | null): string | null;
  linkedVaults(folder: string, home: string | null): LinkedVault[];
  addLink(folder: string, url: string, name?: string): { name: string; repo: string };
  setPath(folder: string, name: string, dir: string): string;
  removeLink(folder: string, name: string): void;
  resolveVault(folder: string, name: string, home: string | null): LinkedVault;
  addressOf(from: string, to: string): string;
};
const vaultMeta = () => createRequire(path.join(REPO_ROOT, 'package.json'))('./lib/vault.js') as { readMeta(folder: string): { slug?: string } };
const HOME = () => path.dirname(DATA_ROOT);
// the folder a vault sits beside (its .wye's parent), or null for a product that is not a vault
const vaultFolder = (productDir: string) => path.basename(productDir) === '.wye' ? path.dirname(productDir) : null;

// Settings › Links: the vaults this one reaches, and changing its repo links (the same as wye link)
export function linkedVaults(productDir: string): LinkedVault[] | null { const f = vaultFolder(productDir); return f ? links().linkedVaults(f, HOME()) : null; }
export function changeLink(productDir: string, b: { action?: string; url?: string; name?: string; path?: string }): void {
  const f = vaultFolder(productDir); if (!f) throw new Error('only a vault beside its code (a folder with .wye) has links');
  const L = links();
  if (b.action === 'add') { L.addLink(f, String(b.url ?? ''), b.name?.trim() || undefined); return; }
  if (b.action === 'path') { L.setPath(f, String(b.name ?? ''), String(b.path ?? '').replace(/^~(?=$|\/)/, process.env.HOME ?? '~')); return; }
  if (b.action === 'remove') { L.removeLink(f, String(b.name ?? '')); return; }
  throw new Error('action: add | path | remove');
}

// Another vault, looked up by the app from the asking product's own links (decision:waterfall.vault-links-resolved-by-the-app):
// the CLI may run where none of these folders are — an agent on another machine through a tunnel — so it names the
// product and the link, and the app answers with everything it needs. By `name` (parent, a child's name, a repo link):
// the other vault, opened here when the app does not know it yet, with how it reaches this one back (`address`) and the
// doc a question for it is filed in. By `address` (a request's reply-to): that vault, or slug null when not on this machine.
export interface ResolvedVault { name: string; kind?: string; folder: string | null; repo?: string; slug: string | null; mine: string; address?: string; project?: string; doc?: string }
export class LinkError extends Error { constructor(message: string, public code: string) { super(message); } }
export async function resolveLinked(productDir: string, by: { name?: string; address?: string }, open: (folder: string) => Promise<string>): Promise<ResolvedVault> {
  const here = vaultFolder(productDir); if (!here) throw new LinkError('this product is not a vault beside its code (a folder with .wye), so it has no linked vaults', 'not-vault');
  const slugOf = (f: string) => vaultMeta().readMeta(f).slug || path.basename(f);
  const mine = slugOf(here);
  if (by.address !== undefined) {
    const f = links().folderOf(here, String(by.address), HOME());
    return { name: String(by.address), folder: f, slug: f ? await open(path.join(f, '.wye')) : null, mine };
  }
  let v: LinkedVault;
  try { v = links().resolveVault(here, String(by.name ?? ''), HOME()); }
  catch (e) { const err = e as Error & { code?: string }; throw new LinkError(err.message, err.code ?? 'unknown'); }
  const folder = v.folder!, project = slugOf(folder);
  return { name: v.name, kind: v.kind, folder, ...(v.repo ? { repo: v.repo } : {}), slug: await open(path.join(folder, '.wye')), mine,
    address: links().addressOf(here, folder), project, doc: existsSync(path.join(folder, '.wye/projects', project, 'docs/decisions.md')) ? 'decisions' : project };
}

export function askedBy(idx: Pick<GraphIndex, 'byId'>, id: string): { by: string; from: string } | null {
  const n = idx.byId.get(id); if (!n) return null;
  const rows = parseBody(n.body ?? ''); const get = (k: string) => rows.find(r => r.key === k)?.value?.trim() ?? '';
  const by = get('asked-by'), from = get('asked-from');
  return by && from ? { by, from } : null;
}

// the vault folder an address names, seen from the vault whose .wye is `productDir` — null when it is not on this machine
export function vaultFolderOf(productDir: string, address: string): string | null {
  const f = vaultFolder(productDir); if (!f) return null;   // only a vault beside its code has an address
  return links().folderOf(f, address, HOME());
}

// the answer to a question another vault asked, into that vault's inbox → the item's name, or null when it is not here
export async function sendAnswerBack(productDir: string, fromVault: string, q: { id: string; title: string }, asked: { by: string; from: string }, answer: string): Promise<string | null> {
  const to = vaultFolderOf(productDir, asked.from); if (!to) return null;
  return addInboxItem(path.join(to, '.wye'), { type: 'note', title: `${fromVault} answered: ${q.title}`, text: answer, from: `vault ${fromVault}`, refs: [q.id], fields: { 'from-vault': fromVault, question: q.title } });
}

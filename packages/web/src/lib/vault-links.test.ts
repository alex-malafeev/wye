import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendAnswerBack, vaultFolderOf, resolveLinked } from './vault-links';

const vault = async (f: string) => { await mkdir(path.join(f, '.wye', 'inbox'), { recursive: true }); await writeFile(path.join(f, '.wye', '_product.md'), '---\ntitle: x\n---\n'); };

// plan:vault-links — req:waterfall.vault-links.ask: the answer to a question another vault asked goes back to its inbox
describe('sendAnswerBack', () => {
  it('writes the answer into the inbox of the vault that asked, found by its address', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vault-links-')));
    const org = path.join(root, 'org'), ios = path.join(org, 'ios');
    await vault(org); await vault(ios);
    expect(vaultFolderOf(path.join(org, '.wye'), 'ios')).toBe(ios);
    const name = await sendAnswerBack(path.join(org, '.wye'), 'org', { id: 'question:org.ios-refunds', title: 'Do refunds go to the card?' }, { by: 'ios', from: 'ios' }, 'Yes, always to the card.');
    expect(name).toBeTruthy();
    const files = (await readdir(path.join(ios, '.wye', 'inbox'))).filter(f => f.endsWith('.md'));
    expect(files).toEqual([name]);
    const md = await readFile(path.join(ios, '.wye', 'inbox', name!), 'utf8');
    expect(md).toContain('org answered: Do refunds go to the card?'); expect(md).toContain('Yes, always to the card.'); expect(md).toContain('question:org.ios-refunds');
  });
  it('sends nothing when the vault that asked is not on this machine', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vault-links-')));
    await vault(path.join(root, 'b'));
    expect(await sendAnswerBack(path.join(root, 'b', '.wye'), 'b', { id: 'question:b.x', title: 'x' }, { by: 'a', from: '../a' }, 'y')).toBeNull();
    expect(await sendAnswerBack(path.join(root, 'b', '.wye'), 'b', { id: 'question:b.x', title: 'x' }, { by: 'a', from: 'https://github.com/acme/nowhere-zz' }, 'y')).toBeNull();
  });
});

// an agent on another machine names the product and the link; the app looks it up from the product's own folders
describe('resolveLinked', () => {
  it('finds the vault above and below by name, and the asking vault by its address', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vault-links-')));
    const org = path.join(root, 'org'), ios = path.join(org, 'ios');
    await vault(org); await vault(ios);
    await writeFile(path.join(org, '.wye', '_product.md'), '---\ntitle: org\nvaults: [ios]\n---\n'); await writeFile(path.join(ios, '.wye', '_product.md'), '---\ntitle: ios\nparent: ..\n---\n');
    const opened: string[] = []; const open = async (f: string) => { opened.push(f); return path.basename(path.dirname(f)) + '-app'; };
    const up = await resolveLinked(path.join(ios, '.wye'), { name: 'parent' }, open);
    expect(up).toMatchObject({ name: 'parent', kind: 'parent', folder: org, slug: 'org-app', mine: 'ios', address: 'ios', project: 'org', doc: 'org' });
    expect(opened).toEqual([path.join(org, '.wye')]);
    expect(await resolveLinked(path.join(org, '.wye'), { name: 'ios' }, open)).toMatchObject({ kind: 'child', slug: 'ios-app', mine: 'org', address: '..' });
    expect(await resolveLinked(path.join(org, '.wye'), { address: 'ios' }, open)).toMatchObject({ folder: ios, slug: 'ios-app', mine: 'org' });
    expect(await resolveLinked(path.join(org, '.wye'), { address: '../elsewhere' }, open)).toMatchObject({ folder: null, slug: null });
    await expect(resolveLinked(path.join(org, '.wye'), { name: 'backend' }, open)).rejects.toThrow(/no linked vault named backend/);
  });
});

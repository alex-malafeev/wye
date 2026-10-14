import { describe, it, expect, vi, type Mock } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';

vi.mock('node:fs/promises', async orig => { const m = await orig<typeof import('node:fs/promises')>(); return { ...m, rename: vi.fn(m.rename) }; });
const fsp = await import('node:fs/promises');
const { writeAtomic } = await import('../write');
const { storePage } = await import('./collab-server');
const { markdownToDoc, docToMarkdown, FRAGMENT } = await import('./collab-blocks');
const { REPO_ROOT } = await import('../products');

// req:waterfall.collaboration.safe-store-live
describe('a live page on disk', () => {
  it('a store cut off before its rename (a crash) leaves the last stored page whole', async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'safe-store-'))); const file = path.join(dir, 'page.md');
    await writeFile(file, 'the last stored page\n');
    (fsp.rename as unknown as Mock).mockRejectedValueOnce(new Error('killed mid-store'));
    await expect(writeAtomic(file, 'half a new page', { live: true })).rejects.toThrow('killed mid-store');
    expect(await readFile(file, 'utf8')).toBe('the last stored page\n');
    await writeAtomic(file, 'the next store\n', { live: true });
    expect(await readFile(file, 'utf8')).toBe('the next store\n');
  });
  it('a store that would lose most of the page is refused, the file left as it was and the version kept aside', async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'safe-store-'))); const file = path.join(dir, 'page.md');
    const body = '\n# Page\n\n' + Array.from({ length: 8 }, (_, i) => `Paragraph ${i} with enough words in it to make the page long.`).join('\n\n') + '\n';
    await writeFile(file, '---\ntitle: Page\n---\n' + body);
    const doc = markdownToDoc(body);
    const page = { name: 'p/p/page', file: path.relative(REPO_ROOT, file), productDir: dir, fileBody: body, stored: docToMarkdown(doc), editors: new Set<string>() };
    const group = doc.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement; group.delete(1, group.length - 1);   // all but the heading gone
    expect(await storePage(page, doc)).toBe('shrunk');
    expect(await readFile(file, 'utf8')).toContain('Paragraph 7');
    const kept = await readdir(path.join(dir, '.refused')); expect(kept).toHaveLength(1);
    expect(await readFile(path.join(dir, '.refused', kept[0]), 'utf8')).not.toContain('Paragraph');
  });
});

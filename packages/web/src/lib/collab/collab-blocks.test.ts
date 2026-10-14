import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { markdownToBlocks, markdownToDoc, docToMarkdown } from './collab-blocks';
import { blocksToMarkdown } from '../serialize';

// what the editor saves for a page today, and what a live document of it stores, must be the same markdown
const roundTrip = (md: string) => { const saved = blocksToMarkdown(markdownToBlocks(md)); const doc = markdownToDoc(md); const live = docToMarkdown(doc); return { saved, live, doc }; };

const PAGE = `# Refunds

Why refunds go to the card. A [link](https://example.com) and **bold**, *italic*, \`code\`.

- [ ] task:shop.refund-api Expose refund status in the API #ready
- req:shop.refund-card A refund goes back to the card it was paid with

\`\`\`yaml
- id: decision:shop.card-only
  title: Refunds go to the card only
  status: proposed
\`\`\`

1. first
2. second

\`\`\`ts
const x = 1;
\`\`\`
`;

describe('a page as a live document (plan:collaboration)', () => {
  it('stores the same markdown the editor saves today', () => {
    const { saved, live } = roundTrip(PAGE);
    expect(live).toBe(saved);
    expect(live).toContain('task:shop.refund-api'); expect(live).toContain('decision:shop.card-only'); expect(live).toContain('const x = 1;');
  });
  it('survives a sync to another document — what a second editor receives', () => {
    const { doc, saved } = roundTrip(PAGE);
    const other = new Y.Doc(); Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    expect(docToMarkdown(other)).toBe(saved);
  });
  it('leaves no browser globals behind on the server', () => {
    roundTrip(PAGE);
    expect((globalThis as Record<string, unknown>).window).toBeUndefined(); expect((globalThis as Record<string, unknown>).document).toBeUndefined();
  });
  it('an empty page is one empty paragraph', () => { expect(roundTrip('').live).toBe(roundTrip('').saved); });

  // WYE_ROUND_TRIP=<vault folder>[,<vault folder>…] takes every page of those vaults through it and lists each one
  // whose live document stores other markdown than the editor saves (task:collaboration.round-trip)
  const vaults = (process.env.WYE_ROUND_TRIP ?? '').split(',').filter(Boolean);
  it.runIf(vaults.length)('every page of the given vaults round-trips', () => {
    const pages: string[] = []; const walk = (d: string) => { for (const e of readdirSync(d)) { const f = path.join(d, e); if (statSync(f).isDirectory()) { if (!['node_modules', '.git', 'inbox', 'assets'].includes(e)) walk(f); } else if (f.endsWith('.md') && f.includes(`${path.sep}docs${path.sep}`)) pages.push(f); } };
    for (const v of vaults) walk(v);
    const diffs: string[] = [];
    for (const f of pages) {
      const md = readFileSync(f, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
      try { const { saved, live } = roundTrip(md); if (saved !== live) { const a = saved.split('\n'), b = live.split('\n'); const i = a.findIndex((l, k) => l !== b[k]); diffs.push(`${f}:${i + 1}\n  saved: ${a[i]}\n  live:  ${b[i]}`); } }
      catch (e) { diffs.push(`${f}: ${e instanceof Error ? e.message : e}`); }
    }
    console.log(`round trip: ${pages.length} pages, ${diffs.length} differ\n${diffs.join('\n')}`);
    expect(diffs).toEqual([]);
  }, 600_000);
});

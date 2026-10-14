import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { markdownToBlocks, markdownToDoc, docToMarkdown, mergeIntoDoc } from './collab-blocks';
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

// decision:waterfall.outside-writes-merge-into-the-live-page
describe('a write merged into a live page', () => {
  const base = '# Page\n\nFirst paragraph.\n\nSecond paragraph.\n\n- req:p.a The first requirement\n';
  // people typed into the first paragraph while the page was live
  const typed = () => { const doc = markdownToDoc(base); const g = doc.getXmlFragment('document-store').get(0) as Y.XmlElement; const para = (g.get(1) as Y.XmlElement).get(0) as Y.XmlElement; (para.get(0) as Y.XmlText).insert(0, 'Typed. '); return doc; };
  it('adds what the writer added and keeps what people typed', () => {
    const doc = typed();
    const r = mergeIntoDoc(doc, base, base + '\n```yaml\n- id: decision:p.new\n  title: A new decision\n  status: proposed\n```\n');
    expect(r).toMatchObject({ changed: true, added: 1, removed: 0 });
    const md = docToMarkdown(doc); expect(md).toContain('Typed. First paragraph.'); expect(md).toContain('decision:p.new');
    expect(md.indexOf('decision:p.new')).toBeGreaterThan(md.indexOf('req:p.a'));
  });
  it('changes the block the writer changed, in place', () => {
    const doc = typed();
    mergeIntoDoc(doc, base, base.replace('- req:p.a The first requirement', '- req:p.a The first requirement #approved'));
    const md = docToMarkdown(doc); expect(md).toContain('Typed. First paragraph.'); expect(md).toContain('req:p.a The first requirement #approved'); expect(md.match(/req:p\.a/g)).toHaveLength(1);
  });
  it('removes what the writer removed', () => {
    const doc = typed();
    mergeIntoDoc(doc, base, base.replace('Second paragraph.\n\n', ''));
    const md = docToMarkdown(doc); expect(md).not.toContain('Second paragraph.'); expect(md).toContain('Typed. First paragraph.');
  });
  it('a block both changed keeps the people\'s version and adds the writer\'s', () => {
    const doc = typed();
    const r = mergeIntoDoc(doc, base, base.replace('First paragraph.', 'First paragraph, rewritten by an agent.'));
    expect(r.kept).toBe(1);
    const md = docToMarkdown(doc); expect(md).toContain('Typed. First paragraph.'); expect(md).toContain('First paragraph, rewritten by an agent.');
  });
  it('reaches a second editor as one update', () => {
    const doc = typed(); const other = new Y.Doc(); Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    doc.on('update', u => Y.applyUpdate(other, u));
    mergeIntoDoc(doc, base, base + '\nAn agent\'s line.\n');
    expect(docToMarkdown(other)).toBe(docToMarkdown(doc)); expect(docToMarkdown(other)).toContain("An agent's line.");
  });
  it('a block the writer changed after one people are typing in stays in its place', () => {
    const doc = typed();
    mergeIntoDoc(doc, base, base.replace('- req:p.a The first requirement', '- req:p.a The first requirement #approved'));
    const md = docToMarkdown(doc);
    expect(md.indexOf('Typed. First paragraph.')).toBeLessThan(md.indexOf('Second paragraph.')); expect(md.indexOf('Second paragraph.')).toBeLessThan(md.indexOf('req:p.a'));
  });
  it('a write from a base that lacks what people typed puts its blocks after the edited one', () => {
    const doc = typed();   // the writer's base is the file: the typing is not in it yet
    mergeIntoDoc(doc, base, base.replace('First paragraph.\n', 'First paragraph.\n\nInserted by an agent.\n'));
    const md = docToMarkdown(doc);
    expect(md.indexOf('Typed. First paragraph.')).toBeLessThan(md.indexOf('Inserted by an agent.')); expect(md.indexOf('Inserted by an agent.')).toBeLessThan(md.indexOf('Second paragraph.'));
  });
  it('nothing changed, nothing done', () => { expect(mergeIntoDoc(typed(), base, base).changed).toBe(false); });
});

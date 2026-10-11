import { describe, it, expect } from 'vitest';
import { rawBrief, fromAgent } from './inbox-raw';

// req:waterfall.card-quality.one-writer
describe('the digest brief', () => {
  it('tells the librarian to propose nothing new for words an agent stored', () => {
    expect(fromAgent('agent session 40abe21600')).toBe(true); expect(fromAgent('agent')).toBe(true);
    expect(fromAgent('alex')).toBe(false); expect(fromAgent(undefined)).toBe(false);
    const b = rawBrief('n.md', 'agent session s1', 'remove the hook', null);
    expect(b).toMatch(/propose no new block/); expect(b).toContain('remove the hook');
  });
  it('lets the librarian file what is new when the person stored the words', () => {
    expect(rawBrief('n.md', 'alex', 'remove the hook', null)).toMatch(/File only what it states that is new/);
  });
});

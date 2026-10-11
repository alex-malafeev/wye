import { describe, it, expect } from 'vitest';
import { batchInstruction } from './work-io';

// decision:waterfall.hook-tasks-batched — one agent, many tasks: the instruction lists them all
describe('batchInstruction', () => {
  it('numbers every task with what it serves, and says how to tick and what to leave', () => {
    const t = batchInstruction([{ id: 'task:p.a', text: 'Define test cases for A', partOf: ['req:p.a'] }, { id: 'task:p.b', text: 'Define test cases for B' }]);
    expect(t).toContain('Work on 2 tasks, one after another:');
    expect(t).toContain('1. task:p.a — Define test cases for A (serves req:p.a)');
    expect(t).toContain('2. task:p.b — Define test cases for B');
    expect(t).toContain('wye node set <task id> --status done');
    expect(t).toContain('stays open as it is, for the next worker');
  });
  it('carries a note', () => { expect(batchInstruction([{ id: 'task:p.a', text: 'x' }], 'More work for this session')).toContain('More work for this session'); });
});

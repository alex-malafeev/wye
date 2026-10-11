import { describe, it, expect } from 'vitest';
import { answerBrief, readQuestion } from './question-answer';

// req:waterfall.card-quality.answer-updates-decision
describe('an answered question', () => {
  const node = (id: string, kind: string, status: string, title: string, body = '') => [id, { id, kind, status, title, body, defined: true }] as const;
  const idx = { byId: new Map<string, any>([
    node('question:p.due', 'question', 'open', 'Date or date-time?', 'q: Is a due a date or a date-time?\nwhy: task:p.picker waits on it\nanswer-changes: date — req:p.due stays; date-time — req:p.due is superseded\ndecides: [decision:p.due-date]'),
    node('decision:p.due-date', 'decision', 'approved', 'A due is a date'),
    node('task:p.x', 'task', 'todo', 'X'),
  ]) };
  it('reads why, what the answer changes and the decisions it settles', () => {
    expect(readQuestion(idx as never, 'question:p.due')).toMatchObject({ q: 'Is a due a date or a date-time?', why: 'task:p.picker waits on it', decides: [{ id: 'decision:p.due-date', status: 'approved', title: 'A due is a date' }] });
    expect(readQuestion(idx as never, 'task:p.x')).toBeNull();
  });
  it('briefs the librarian with the answer, the decision to supersede or refine, and the question to resolve', () => {
    const b = answerBrief(readQuestion(idx as never, 'question:p.due')!, 'a date-time — meetings need the hour', '2026-10-11');
    expect(b).toContain('a date-time — meetings need the hour');
    expect(b).toContain('decision:p.due-date [decision, approved]');
    expect(b).toMatch(/approved → propose a new decision that `supersedes:`/);
    expect(b).toContain('resolves: [question:p.due]');
    expect(b).toContain('wye node set question:p.due --status resolved');
  });
});

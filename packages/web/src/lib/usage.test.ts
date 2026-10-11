import { describe, it, expect } from 'vitest';
import { parseClaudeUsage, parseCodexUsage } from './usage';

// decision:waterfall.status-bar-memory-and-limits — the windows the status bar shows, from the endpoints' shapes
describe('parseClaudeUsage', () => {
  it('reads the session, the week and a per-model weekly limit from limits[]', () => {
    const w = parseClaudeUsage({ five_hour: { utilization: 21, resets_at: '2026-10-11T17:30:00+00:00' }, seven_day: { utilization: 41, resets_at: '2026-10-16T11:00:00+00:00' }, limits: [
      { kind: 'session', group: 'session', percent: 21, resets_at: '2026-10-11T17:30:00+00:00' },
      { kind: 'weekly_all', group: 'weekly', percent: 41, resets_at: '2026-10-16T11:00:00+00:00' },
      { kind: 'weekly_scoped', group: 'weekly', percent: 52, resets_at: '2026-10-16T11:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
    ] });
    expect(w).toEqual([{ label: '5h', percent: 21, resetsAt: '2026-10-11T17:30:00+00:00' }, { label: 'week', percent: 41, resetsAt: '2026-10-16T11:00:00+00:00' }, { label: 'Fable', percent: 52, resetsAt: '2026-10-16T11:00:00+00:00' }]);
  });
  it('falls back to five_hour and seven_day when limits[] is missing', () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 3.6 }, seven_day: { utilization: 10 }, limits: null })).toEqual([{ label: '5h', percent: 4, resetsAt: undefined }, { label: 'week', percent: 10, resetsAt: undefined }]);
  });
});
describe('parseCodexUsage', () => {
  it('reads the primary and secondary windows and the plan', () => {
    const r = parseCodexUsage({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: 1791730612 }, secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 1792295899 } } });
    expect(r.plan).toBe('plus');
    expect(r.windows.map(w => [w.label, w.percent])).toEqual([['5h', 5], ['week', 2]]);
    expect(r.windows[0].resetsAt).toBe(new Date(1791730612 * 1000).toISOString());
  });
  it('an account without limits has no windows', () => { expect(parseCodexUsage({})).toEqual({ plan: undefined, windows: [] }); });
});

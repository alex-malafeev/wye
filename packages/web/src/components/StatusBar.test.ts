import { describe, it, expect } from 'vitest';
import { untilReset } from './StatusBar';

// decision:waterfall.status-bar-memory-and-limits — the time to a window's reset, as the bar says it
describe('untilReset', () => {
  const now = Date.parse('2026-10-11T14:00:00Z');
  it('minutes, then hours and minutes, then days and hours', () => {
    expect(untilReset('2026-10-11T14:25:00Z', now)).toBe('25m');
    expect(untilReset('2026-10-11T16:58:00Z', now)).toBe('2h 58m');
    expect(untilReset('2026-10-16T10:00:00Z', now)).toBe('4d 20h');
  });
  it('nothing for a past or missing reset', () => { expect(untilReset('2026-10-11T13:00:00Z', now)).toBe(''); expect(untilReset(undefined, now)).toBe(''); });
});

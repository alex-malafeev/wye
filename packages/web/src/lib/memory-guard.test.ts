import { describe, it, expect, vi } from 'vitest';
import { usedBytes, overCap, startMemoryGuard, RESTART_EXIT_CODE } from './memory-guard';

const GB = 2 ** 30;
const mem = (rss: number, heapUsed = 0, external = 0) => ({ rss, heapUsed, external, heapTotal: heapUsed, arrayBuffers: 0 });

// decision:waterfall.app-restarts-over-memory-cap
describe('memory guard', () => {
  it('counts the heap when the OS has paged the resident set out', () => {
    expect(usedBytes(mem(0.2 * GB, 8 * GB, 0.1 * GB))).toBe(8.1 * GB);
    expect(usedBytes(mem(3 * GB, 1 * GB))).toBe(3 * GB);
    expect(overCap(mem(0.2 * GB, 39 * GB), 40)).toBe(false);
    expect(overCap(mem(0.2 * GB, 40 * GB), 40)).toBe(true);
  });
  it('stops the agents and exits with the code the parent restarts on, once', async () => {
    vi.useFakeTimers();
    const exit = vi.fn(); const stopAgents = vi.fn(async (_reason: string) => {});
    let used = 1 * GB;
    const stop = startMemoryGuard({ everyMs: 10, capGb: 4, usage: () => mem(used), exit, stopAgents });
    await vi.advanceTimersByTimeAsync(25);
    expect(stopAgents).not.toHaveBeenCalled();
    used = 4 * GB;
    await vi.advanceTimersByTimeAsync(10);
    expect(stopAgents).toHaveBeenCalledTimes(1);
    expect(stopAgents.mock.calls[0][0]).toMatch(/4 GB, over its cap of 4 GB/);
    await vi.advanceTimersByTimeAsync(2100);
    expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    expect(stopAgents).toHaveBeenCalledTimes(1); // the later ticks do not stop them again
    stop(); vi.useRealTimers();
  });
});

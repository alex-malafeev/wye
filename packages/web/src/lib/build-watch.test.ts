import { describe, it, expect, vi } from 'vitest';
import { startBuildWatch } from './build-watch';
import { RESTART_EXIT_CODE } from './memory-guard';

// decision:waterfall.app-restarts-on-new-build
describe('build watch', () => {
  it('restarts once when the build it started with is replaced, not while a build is under way', async () => {
    vi.useFakeTimers();
    const exit = vi.fn(); const stopAgents = vi.fn(async (_reason: string) => {});
    let id: string | null = 'a';
    const stop = startBuildWatch({ everyMs: 10, read: () => id, exit, stopAgents });
    await vi.advanceTimersByTimeAsync(25);
    id = null; // next build has removed it
    await vi.advanceTimersByTimeAsync(25);
    expect(stopAgents).not.toHaveBeenCalled();
    id = 'b';
    await vi.advanceTimersByTimeAsync(10);
    expect(stopAgents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    expect(stopAgents).toHaveBeenCalledTimes(1);
    stop(); vi.useRealTimers();
  });
  it('does nothing for a server that started without a build (next dev)', async () => {
    vi.useFakeTimers();
    const exit = vi.fn(); let id: string | null = null;
    const stop = startBuildWatch({ everyMs: 10, read: () => id, exit, stopAgents: async () => {} });
    id = 'b';
    await vi.advanceTimersByTimeAsync(50);
    expect(exit).not.toHaveBeenCalled();
    stop(); vi.useRealTimers();
  });
});

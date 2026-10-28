import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Poller } from "./poller";

const log = { error: vi.fn() };

function makePoller(delays: number[] = [1000]) {
  const calls: number[] = [];
  let resolveCurrent: (() => void) | undefined;
  const poller = new Poller(async () => {
    calls.push(Date.now());
    await new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    return delays[Math.min(calls.length - 1, delays.length - 1)] ?? 1000;
  }, log);
  const finish = async () => {
    resolveCurrent?.();
    resolveCurrent = undefined;
    await vi.advanceTimersByTimeAsync(0);
  };
  return { poller, calls, finish };
}

describe("Poller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedules the next poll with the delay the task returns", async () => {
    const { poller, calls, finish } = makePoller([1000, 5000]);
    poller.runNow();
    expect(calls).toHaveLength(1);
    await finish();
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(3);
    poller.dispose();
  });

  it("queues one rerun when runNow arrives mid-poll instead of overlapping", async () => {
    const { poller, calls, finish } = makePoller();
    poller.runNow();
    poller.runNow();
    poller.runNow();
    expect(calls).toHaveLength(1);
    await finish();
    expect(calls).toHaveLength(2);
    await finish();
    expect(calls).toHaveLength(2);
    poller.dispose();
  });

  it("pauses without cancelling the running poll and resumes with an immediate poll", async () => {
    const { poller, calls, finish } = makePoller();
    poller.runNow();
    poller.pause();
    expect(poller.isPaused).toBe(true);
    await finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
    poller.resume();
    expect(poller.isPaused).toBe(false);
    expect(calls).toHaveLength(2);
    poller.dispose();
  });

  it("resume always polls at once, even when it was not paused", async () => {
    const { poller, calls, finish } = makePoller();
    poller.runNow();
    await finish();
    poller.resume();
    expect(calls).toHaveLength(2);
    poller.dispose();
  });

  it("rescheduleIn replaces the pending timer, clears a pause, and defers to a running poll", async () => {
    const { poller, calls, finish } = makePoller([1000]);
    poller.runNow();
    await finish();
    poller.rescheduleIn(60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    poller.rescheduleIn(60_000); // mid-poll: ignored, the poll schedules its own successor
    await finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    await finish();
    poller.pause();
    poller.rescheduleIn(500);
    expect(poller.isPaused).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(4);
    poller.dispose();
  });

  it("logs a throwing task and keeps polling with the fallback delay", async () => {
    let n = 0;
    const poller = new Poller(async () => {
      n++;
      throw new Error("boom");
    }, log);
    poller.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith("Unexpected poll failure: boom");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(n).toBe(2);
    poller.dispose();
  });

  it("stops scheduling once disposed", async () => {
    const { poller, calls, finish } = makePoller();
    poller.runNow();
    poller.dispose();
    await finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
    poller.runNow();
    expect(calls).toHaveLength(1);
  });
});

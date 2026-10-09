import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { padToFloor } from "./floor";

describe("padToFloor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the remaining time up to the floor", async () => {
    const started = Date.now();
    let done = false;
    const p = padToFloor(started, 500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("only waits the remainder when some time already elapsed", async () => {
    const started = Date.now() - 300;
    let done = false;
    const p = padToFloor(started, 500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("is a no-op when the floor has already passed", async () => {
    await padToFloor(Date.now() - 1000, 500);
    expect(vi.getTimerCount()).toBe(0);
  });
});

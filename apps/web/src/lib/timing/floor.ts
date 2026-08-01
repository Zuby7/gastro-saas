/**
 * Timing-side-channel mitigation helper (ticket #7 fix cycle 1): pads a
 * request's total elapsed time up to a fixed floor, so branches that do
 * different amounts of real work (e.g. a real bcrypt password verify vs. an
 * early return for an unknown email) can't be told apart by response
 * latency. Never speeds anything up -- a genuinely slow real path is left
 * alone; only faster branches are delayed to match.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits until at least `floorMs` milliseconds have elapsed since
 * `startedAt` (a `Date.now()` timestamp captured at the start of the
 * request/branch being equalized). No-op if that much time has already
 * passed.
 */
export async function padToFloor(startedAt: number, floorMs: number): Promise<void> {
  const remaining = floorMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await sleep(remaining);
  }
}

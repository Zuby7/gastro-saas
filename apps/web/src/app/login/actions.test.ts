import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPasswordMock = vi.fn();
const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const recordFailedLoginAttemptMock = vi.fn();
const afterMock = vi.fn((callback: () => unknown) => callback());
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterMock(callback),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: signInWithPasswordMock },
  }),
}));

vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({
    reserveAttempt: reserveAttemptMock,
    markSucceeded: markSucceededMock,
  }),
}));

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: async () => "203.0.113.10",
}));

vi.mock("@/lib/audit/login-audit", () => ({
  recordFailedLoginAttempt: (...args: unknown[]) => recordFailedLoginAttemptMock(...args),
}));

function formData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

function notLimitedReservation() {
  return { attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 };
}

function limitedReservation() {
  return { attemptId: "attempt-6", ipCount: 6, ipEmailCount: 6 };
}

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttemptMock.mockResolvedValue(notLimitedReservation());
});

describe("loginAction", () => {
  it("blocks the 6th attempt within the window without ever calling signInWithPassword", async () => {
    reserveAttemptMock.mockResolvedValue(limitedReservation());

    const { loginAction } = await import("./actions");
    const result = await loginAction({}, formData("victim@example.com", "whatever"));

    expect(result.error).toBe("Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.");
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("returns byte-identical error strings for a wrong password and an unknown email", async () => {
    const { loginAction } = await import("./actions");

    signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });
    const wrongPasswordResult = await loginAction(
      {},
      formData("existing@example.com", "wrongPassword123!"),
    );

    signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });
    const unknownEmailResult = await loginAction(
      {},
      formData("nonexistent@example.com", "anyPassword123!"),
    );

    expect(wrongPasswordResult.error).toBe(unknownEmailResult.error);
    expect(wrongPasswordResult.error).toBe("E-Mail-Adresse oder Passwort ist ungültig.");
  });

  it("registers the failed-login audit write via next/server's after() instead of an unmanaged fire-and-forget call (ticket #61)", async () => {
    // On a serverless/edge runtime, a bare `void recordFailedLoginAttempt(...)`
    // can be dropped if the process is frozen/recycled right after the
    // response is sent. `after()` guarantees the callback runs to completion
    // as part of the request lifecycle.
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    const { loginAction } = await import("./actions");
    await loginAction({}, formData("existing@example.com", "wrongPassword123!"));

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(recordFailedLoginAttemptMock).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      "existing@example.com",
    );
  });

  it("redirects to /account and marks the rate-limit attempt succeeded on a real login", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: { access_token: "token" } },
      error: null,
    });

    const { loginAction } = await import("./actions");
    await expect(
      loginAction({}, formData("owner@example.com", "correctPassword123!")),
    ).rejects.toThrow("NEXT_REDIRECT:/account");

    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
  });

  it("equalizes response latency between a real bcrypt-verify (wrong password) path and an early-return (unknown email) path", async () => {
    // Ticket #7 fix cycle 1, item 1: originally measured ~74ms (existing
    // email, wrong password -- real bcrypt verify) vs ~11ms (nonexistent
    // email -- early return), a usable existence oracle. Simulate that gap
    // here with realistic delays and assert loginAction's total elapsed
    // time no longer distinguishes the two cases.
    const { loginAction } = await import("./actions");

    signInWithPasswordMock.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ data: { session: null }, error: { message: "Invalid login credentials" } }),
            80,
          ),
        ),
    );
    const wrongPasswordStart = Date.now();
    await loginAction({}, formData("existing@example.com", "wrongPassword123!"));
    const wrongPasswordElapsed = Date.now() - wrongPasswordStart;

    signInWithPasswordMock.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ data: { session: null }, error: { message: "Invalid login credentials" } }),
            5,
          ),
        ),
    );
    const unknownEmailStart = Date.now();
    await loginAction({}, formData("nonexistent@example.com", "anyPassword123!"));
    const unknownEmailElapsed = Date.now() - unknownEmailStart;

    // Both should have been padded up to (approximately) the same floor.
    expect(wrongPasswordElapsed).toBeGreaterThanOrEqual(190);
    expect(unknownEmailElapsed).toBeGreaterThanOrEqual(190);
    expect(Math.abs(wrongPasswordElapsed - unknownEmailElapsed)).toBeLessThan(40);
  });
});

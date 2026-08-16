import { beforeEach, describe, expect, it, vi } from "vitest";

const signUpMock = vi.fn();
const rpcMock = vi.fn();
const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signUp: signUpMock },
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({
    reserveAttempt: reserveAttemptMock,
    markSucceeded: markSucceededMock,
  }),
}));

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: async () => "203.0.113.20",
}));

function validFormData(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("tenantName", overrides.tenantName ?? "Testrestaurant");
  fd.set("tenantSlug", overrides.tenantSlug ?? "testrestaurant");
  fd.set("email", overrides.email ?? "owner@example.com");
  fd.set("password", overrides.password ?? "Sup3rSecurePassw0rd!");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 });
});

describe("registerAction", () => {
  it("blocks the 6th registration attempt within the window without calling signUp", async () => {
    reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-6", ipCount: 6, ipEmailCount: 6 });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.error).toContain("Zu viele Registrierungsversuche");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  // Opus review finding on PR #101/#106: reserveAndCheckRateLimit's default
  // IP-only threshold multiplier (ticket #62, scoped to login/invite only)
  // must NOT silently widen the register scope's IP-only threshold. ipCount:
  // 6 exceeds maxAttempts (5) but would NOT exceed an implicit 4x-widened
  // threshold (20) -- if register's maxIpAttempts weren't explicitly pinned
  // to 5, this attempt would wrongly be allowed through.
  it("blocks a register attempt once the IP-only count exceeds its own (unwidened) threshold", async () => {
    reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-6", ipCount: 6, ipEmailCount: 1 });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.error).toContain("Zu viele Registrierungsversuche");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("creates the tenant and redirects on a full successful signup", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: { access_token: "token" }, user: { identities: [{ id: "1" }] } },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: "tenant-id", error: null });

    const { registerAction } = await import("./actions");
    await expect(registerAction({}, validFormData())).rejects.toThrow("NEXT_REDIRECT:/account");

    expect(rpcMock).toHaveBeenCalledWith("create_tenant_with_owner", {
      p_tenant_name: "Testrestaurant",
      p_tenant_slug: "testrestaurant",
    });
    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
  });

  it("handles email-confirmation-required signups (no session yet) with an informational message, not a dead-end error", async () => {
    // Ticket #7 fix cycle 1, item 5: with enable_confirmations = true,
    // signUp() succeeds but returns no session -- tenant creation must be
    // deferred, not treated as a failure.
    signUpMock.mockResolvedValueOnce({
      data: { session: null, user: { id: "user-1", identities: [{ id: "1" }] } },
      error: null,
    });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.error).toBeUndefined();
    expect(result.info).toContain("bestätigen");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("points an already-registered email at /login instead of a dead end (item 4: orphaned-auth-user recovery)", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "User already registered" },
    });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.error).toContain("bereits registriert");
    expect(result.error).toContain("melden Sie sich an");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reports a slug conflict distinctly and does not lose the created account", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: { access_token: "token" }, user: { identities: [{ id: "1" }] } },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.fieldErrors?.tenantSlug).toBeDefined();
    expect(result.error).toContain("bereits vergeben");
  });
});

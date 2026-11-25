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

const isTenantSlugTakenMock = vi.fn(async (..._args: unknown[]) => false);

vi.mock("@/lib/tenant/slug-availability", () => ({
  isTenantSlugTaken: (...args: unknown[]) => isTenantSlugTakenMock(...args),
}));

const padToFloorMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/timing/floor", () => ({
  padToFloor: (...args: unknown[]) => padToFloorMock(...args),
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
  fd.set("acceptTerms", overrides.acceptTerms ?? "on");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 });
  isTenantSlugTakenMock.mockResolvedValue(false);
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

  it("carries tenant name/slug into signUp's user_metadata so it survives email confirmation (ticket #60)", async () => {
    // With enable_confirmations=true, signUp() returns no session and this
    // action defers tenant creation to first login -- the only way to
    // recover the tenant name/slug the user already typed is if signUp()
    // stashed it in user_metadata here.
    signUpMock.mockResolvedValueOnce({
      data: { session: null, user: { id: "user-1", identities: [{ id: "1" }] } },
      error: null,
    });

    const { registerAction } = await import("./actions");
    await registerAction(
      {},
      validFormData({ tenantName: "Pizzeria Napoli", tenantSlug: "pizzeria-napoli" }),
    );

    expect(signUpMock).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "Sup3rSecurePassw0rd!",
      options: { data: { tenant_name: "Pizzeria Napoli", tenant_slug: "pizzeria-napoli" } },
    });
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
    expect(result.info).toContain("Bestätigungslink");
    expect(result.info).toContain("Postfach");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
  });

  // Issue #204 (audit 2026-11): the form must not reveal whether an address
  // already has an account.
  describe("enumeration safety (issue #204)", () => {
    async function outcomeFor(signUpResult: unknown) {
      vi.clearAllMocks();
      reserveAttemptMock.mockResolvedValue({
        attemptId: "attempt-1",
        ipCount: 1,
        ipEmailCount: 1,
      });
      signUpMock.mockResolvedValueOnce(signUpResult);
      const { registerAction } = await import("./actions");
      const result = await registerAction({}, validFormData());
      return {
        result,
        markSucceededCalls: markSucceededMock.mock.calls.length,
        padCalls: padToFloorMock.mock.calls.map((call) => call[1]),
        rpcCalls: rpcMock.mock.calls.length,
      };
    }

    const newAddress = {
      data: { session: null, user: { id: "user-1", identities: [{ id: "1" }] } },
      error: null,
    };
    // Supabase's obfuscated response for an existing address when email
    // confirmations are enabled.
    const existingObfuscated = {
      data: { session: null, user: { id: "fake-id", identities: [] } },
      error: null,
    };
    // Supabase's response for an existing address when confirmations are off.
    const existingError = {
      data: { session: null, user: null },
      error: { message: "User already registered" },
    };

    it("returns the identical outcome for a new and an already-registered address", async () => {
      const fresh = await outcomeFor(newAddress);
      const obfuscated = await outcomeFor(existingObfuscated);
      const errored = await outcomeFor(existingError);

      expect(fresh.result.info).toBeDefined();
      expect(fresh.result.error).toBeUndefined();
      expect(obfuscated).toEqual(fresh);
      expect(errored).toEqual(fresh);
    });

    it("never says that the address is already registered", async () => {
      for (const response of [existingObfuscated, existingError]) {
        const { result } = await outcomeFor(response);
        expect(JSON.stringify(result)).not.toContain("bereits registriert");
        expect(result.info).toContain("melden Sie sich bitte direkt an");
      }
    });

    it("pads the neutral outcome to the response floor, measured from the start of the request", async () => {
      const { padCalls } = await outcomeFor(existingObfuscated);
      expect(padCalls).toEqual([500]);
      expect(padToFloorMock.mock.calls[0]?.[0]).toEqual(expect.any(Number));
    });

    it("keeps other signUp failures a generic error, padded to the same floor", async () => {
      const { result, padCalls, markSucceededCalls } = await outcomeFor({
        data: { session: null, user: null },
        error: { message: "Password should be at least 12 characters" },
      });
      expect(result.error).toContain("Registrierung nicht möglich");
      expect(result.info).toBeUndefined();
      expect(padCalls).toEqual([500]);
      expect(markSucceededCalls).toBe(0);
    });
  });

  it("rejects a taken web address with a slug field error BEFORE signUp, so the user can fix it and resubmit", async () => {
    isTenantSlugTakenMock.mockResolvedValueOnce(true);

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData({ tenantSlug: "vergeben" }));

    expect(isTenantSlugTakenMock).toHaveBeenCalledWith({ __marker: "admin-client" }, "vergeben");
    expect(result.fieldErrors?.tenantSlug).toContain("bereits vergeben");
    expect(signUpMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(padToFloorMock.mock.calls.map((call) => call[1])).toEqual([500]);
  });

  it("does not reveal e-mail state when the slug is free: an existing address still gets the neutral answer", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: null, user: { id: "fake-id", identities: [] } },
      error: null,
    });

    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData());

    expect(result.info).toContain("Falls diese E-Mail-Adresse");
    expect(result.fieldErrors).toBeUndefined();
  });

  it("redirects a racing slug conflict (after signUp) to /account instead of an error loop", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: { access_token: "token" }, user: { identities: [{ id: "1" }] } },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const { registerAction } = await import("./actions");
    await expect(registerAction({}, validFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/account?notice=tenant-slug-taken",
    );
    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
  });

  it("redirects any other tenant-creation failure after signUp to /account with a notice", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { session: { access_token: "token" }, user: { identities: [{ id: "1" }] } },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });

    const { registerAction } = await import("./actions");
    await expect(registerAction({}, validFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/account?notice=tenant-create-failed",
    );
  });

  // Ticket #146: explicit AGB/Datenschutz consent is required server-side,
  // not just enforced by the checkbox's `required` HTML attribute.
  it("rejects registration when the AGB/Datenschutz consent checkbox was not accepted", async () => {
    const { registerAction } = await import("./actions");
    const result = await registerAction({}, validFormData({ acceptTerms: "" }));

    expect(result.fieldErrors?.acceptTerms).toBeDefined();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});

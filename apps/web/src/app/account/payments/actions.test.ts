import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const createExpressAccountMock = vi.fn();
const createOnboardingAccountLinkMock = vi.fn();
const adminFromMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

// The server action must never insert `payment_accounts` through the
// caller's own session client (which holds no INSERT grant on that table as
// of the epic-7 batch review fix) -- only through the service-role admin
// client, immediately after this exact call created the Stripe account.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: adminFromMock }),
}));

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({ __fakeStripe: true }),
}));

vi.mock("@/lib/stripe/connect", () => ({
  createExpressAccount: (...args: unknown[]) => createExpressAccountMock(...args),
  createOnboardingAccountLink: (...args: unknown[]) => createOnboardingAccountLinkMock(...args),
}));

function membershipQueryBuilder(result: { data: { tenant_id: string; role: string } | null }) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data: result.data, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "owner@example.test" } } });
  rpcMock.mockResolvedValue({ data: null, error: null });
  createExpressAccountMock.mockResolvedValue({ id: "acct_new" });
  createOnboardingAccountLinkMock.mockResolvedValue({
    url: "https://connect.stripe.com/setup/xyz",
  });
});

describe("startStripeOnboardingAction", () => {
  it("denies onboarding when the caller lacks payments.connect (issue #95 -- Owner-only, not payments.read)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });
    fromMock.mockImplementation(() =>
      membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );

    const { startStripeOnboardingAction } = await import("./actions");
    const result = await startStripeOnboardingAction({}, new FormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(createExpressAccountMock).not.toHaveBeenCalled();
  });

  it("creates a new Express account, persists it tenant-scoped via the service-role client, and redirects to the Account Link", async () => {
    let upsertedPayload: unknown;
    let upsertOptions: unknown;
    let updatedPayload: unknown;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      // audit_logs insert -- goes through the caller's own session client.
      return { insert: async () => ({ error: null }) };
    });
    adminFromMock.mockImplementation((table: string) => {
      if (table === "payment_accounts") {
        return {
          upsert: async (payload: unknown, options: unknown) => {
            upsertedPayload = payload;
            upsertOptions = options;
            return { error: null };
          },
          // Reconciliation read (issue #92 Opus review finding): no prior
          // attempt has recorded a stripe_account_id yet.
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            updatedPayload = payload;
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    });

    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/xyz",
    );

    // Phase 1 (issue #92): a provisioning row is upserted BEFORE Stripe is
    // ever called, so a retry after a later failure has a stable row/id to
    // derive the idempotency key from instead of orphaning a new account.
    expect(upsertedPayload).toMatchObject({
      tenant_id: "tenant-1",
      created_by_user_id: "user-1",
    });
    expect(upsertOptions).toMatchObject({ onConflict: "tenant_id", ignoreDuplicates: true });

    expect(createExpressAccountMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      { tenantId: "tenant-1", email: "owner@example.test" },
      { idempotencyKey: "stripe-express-account:tenant-1" },
    );
    // Regression test (epic-7 batch review finding 1): the row is
    // written only via the service-role admin client, never the caller's
    // own session client -- `stripe_account_id` is always the value this
    // action itself just received from `createExpressAccount()`, never
    // something a client could supply directly.
    expect(updatedPayload).toMatchObject({ stripe_account_id: "acct_new" });
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      expect.objectContaining({ accountId: "acct_new" }),
    );
  });

  it("issue #92: retries after a mid-flight DB update failure reuse the same Stripe account via a matching idempotency key", async () => {
    let updateCallCount = 0;
    let updateShouldFail = true;
    const upsertCalls: unknown[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              // Both the first attempt and the retry see no committed
              // stripe_account_id yet -- the provisioning row from phase 1
              // never got its stripe_account_id written on the first,
              // failed attempt.
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    });

    adminFromMock.mockImplementation((table: string) => {
      if (table === "payment_accounts") {
        return {
          upsert: async (payload: unknown, options: unknown) => {
            upsertCalls.push({ payload, options });
            return { error: null };
          },
          // Reconciliation read (issue #92 Opus review finding): the
          // provisioning row's stripe_account_id never got persisted by the
          // first, failed attempt, so both the first attempt and the retry
          // see it as still unset here -- Stripe itself must be called.
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => {
              updateCallCount += 1;
              if (updateShouldFail) {
                return { error: { message: "simulated DB failure" } };
              }
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    });

    const { startStripeOnboardingAction } = await import("./actions");

    // First attempt: Stripe account creation succeeds, but the DB update
    // that would persist stripe_account_id fails.
    const firstResult = await startStripeOnboardingAction({}, new FormData());
    expect(firstResult.error).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(updateCallCount).toBe(1);

    // Retry: the DB update now succeeds.
    updateShouldFail = false;
    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/xyz",
    );
    expect(updateCallCount).toBe(2);

    // The load-bearing assertion: both Stripe calls used the exact same
    // idempotency key (derived from tenant_id), so Stripe itself -- not
    // just this app's retry logic -- would return the original Express
    // account rather than creating a second, orphaned one.
    expect(createExpressAccountMock).toHaveBeenCalledTimes(2);
    const [firstCallArgs, secondCallArgs] = createExpressAccountMock.mock.calls;
    expect(firstCallArgs).toBeDefined();
    expect(secondCallArgs).toBeDefined();
    expect(firstCallArgs![2]).toEqual({ idempotencyKey: "stripe-express-account:tenant-1" });
    expect(secondCallArgs![2]).toEqual(firstCallArgs![2]);

    // Both attempts also (re-)upsert the same provisioning row -- the
    // second, ignoreDuplicates upsert is a no-op against the row the first
    // attempt already created.
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0]).toMatchObject({
      payload: { tenant_id: "tenant-1", created_by_user_id: "user-1" },
      options: { onConflict: "tenant_id", ignoreDuplicates: true },
    });
    expect(upsertCalls[1]).toEqual(upsertCalls[0]);
  });

  it("issue #92 (Opus review finding): a provisioning row that already has a stripe_account_id from a prior attempt is reused, never re-created -- covers the >24h idempotency-key-expiry case where the caller's own session read is stale/misses it", async () => {
    let adminUpdateCallCount = 0;

    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              // The caller's own session-client read (done once, before
              // phase 1) does not yet see the row -- simulating either a
              // stale read or a prior, separate attempt racing ahead.
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    });

    adminFromMock.mockImplementation((table: string) => {
      if (table === "payment_accounts") {
        return {
          upsert: async () => ({ error: null }),
          // The reconciliation read done via the service-role client right
          // before calling Stripe *does* see a stripe_account_id already
          // recorded on the provisioning row -- e.g. from an attempt more
          // than 24h ago whose Stripe idempotency key has since expired.
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { stripe_account_id: "acct_from_prior_attempt" },
                error: null,
              }),
            }),
          }),
          update: () => {
            adminUpdateCallCount += 1;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    });

    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/xyz",
    );

    // The load-bearing assertion (issue #92 real-bug finding): no second
    // Stripe Express account is ever created -- the reconciled row's
    // existing stripe_account_id is reused as-is.
    expect(createExpressAccountMock).not.toHaveBeenCalled();
    expect(adminUpdateCallCount).toBe(0);
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      expect.objectContaining({ accountId: "acct_from_prior_attempt" }),
    );
  });

  it("reuses an existing Stripe account instead of creating a second one", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { stripe_account_id: "acct_existing" },
                error: null,
              }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    });

    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/xyz",
    );

    expect(createExpressAccountMock).not.toHaveBeenCalled();
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      expect.objectContaining({ accountId: "acct_existing" }),
    );
  });
});

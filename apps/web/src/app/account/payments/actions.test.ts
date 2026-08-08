import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const createExpressAccountMock = vi.fn();
const createOnboardingAccountLinkMock = vi.fn();

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
  it("denies onboarding when the caller lacks payments.read", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });
    fromMock.mockImplementation(() =>
      membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );

    const { startStripeOnboardingAction } = await import("./actions");
    const result = await startStripeOnboardingAction({}, new FormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(createExpressAccountMock).not.toHaveBeenCalled();
  });

  it("creates a new Express account, persists it tenant-scoped, and redirects to the Account Link", async () => {
    let insertedPayload: unknown;
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
          insert: async (payload: unknown) => {
            insertedPayload = payload;
            return { error: null };
          },
        };
      }
      // audit_logs insert
      return { insert: async () => ({ error: null }) };
    });

    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/xyz",
    );

    expect(createExpressAccountMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      { tenantId: "tenant-1", email: "owner@example.test" },
    );
    expect(insertedPayload).toMatchObject({
      tenant_id: "tenant-1",
      stripe_account_id: "acct_new",
      created_by_user_id: "user-1",
    });
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      expect.objectContaining({ accountId: "acct_new" }),
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

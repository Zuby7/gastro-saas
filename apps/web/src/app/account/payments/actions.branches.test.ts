import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const adminFromMock = vi.fn();
const createExpressAccountMock = vi.fn();
const createOnboardingAccountLinkMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

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

function sessionFrom(options: { membership: { tenant_id: string; role: string } | null }) {
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: options.membership }) }),
          }),
        }),
      };
    }
    if (table === "payment_accounts") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    }
    return { insert: async () => ({ error: null }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "o@example.test" } } });
  rpcMock.mockResolvedValue({ data: null, error: null });
  createExpressAccountMock.mockResolvedValue({ id: "acct_new" });
  createOnboardingAccountLinkMock.mockResolvedValue({ url: "https://connect.stripe.com/x" });
});

describe("startStripeOnboardingAction -- remaining branches", () => {
  it("redirects to /login when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    sessionFrom({ membership: null });
    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(createExpressAccountMock).not.toHaveBeenCalled();
  });

  it("returns an error when the user belongs to no restaurant", async () => {
    sessionFrom({ membership: null });
    const { startStripeOnboardingAction } = await import("./actions");

    const result = await startStripeOnboardingAction({}, new FormData());

    expect(result.error).toContain("noch keinem Restaurant");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(createExpressAccountMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected (non-permission) errors from the permission check", async () => {
    sessionFrom({ membership: { tenant_id: "tenant-1", role: "owner" } });
    rpcMock.mockRejectedValue(new Error("db down"));
    const { startStripeOnboardingAction } = await import("./actions");

    await expect(startStripeOnboardingAction({}, new FormData())).rejects.toThrow("db down");
    expect(createExpressAccountMock).not.toHaveBeenCalled();
  });

  it("returns a generic error and never calls Stripe when the provisioning upsert fails", async () => {
    sessionFrom({ membership: { tenant_id: "tenant-1", role: "owner" } });
    adminFromMock.mockImplementation(() => ({
      upsert: async () => ({ error: { message: "rls denied" } }),
    }));
    const { startStripeOnboardingAction } = await import("./actions");

    const result = await startStripeOnboardingAction({}, new FormData());

    expect(result.error).toContain("konnte nicht angelegt werden");
    expect(result.error).not.toContain("rls denied");
    expect(createExpressAccountMock).not.toHaveBeenCalled();
    expect(createOnboardingAccountLinkMock).not.toHaveBeenCalled();
  });
});

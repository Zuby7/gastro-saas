import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
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

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({ __fakeStripe: true }),
}));

vi.mock("@/lib/stripe/connect", () => ({
  createOnboardingAccountLink: (...args: unknown[]) => createOnboardingAccountLinkMock(...args),
}));

function setup(options: {
  membership?: { tenant_id: string; role: string } | null;
  existing?: { stripe_account_id: string } | null;
  permissionError?: "denied" | "unexpected" | null;
}) {
  const membership =
    options.membership === undefined
      ? { tenant_id: "tenant-1", role: "owner" }
      : options.membership;
  fromMock.mockImplementation((table: string) => ({
    select: () => ({
      eq: (column: string, value: string) => ({
        limit: () => ({ maybeSingle: async () => ({ data: membership }) }),
        maybeSingle: async () => {
          expect(table).toBe("payment_accounts");
          expect([column, value]).toEqual(["tenant_id", "tenant-1"]);
          return { data: options.existing ?? null };
        },
      }),
    }),
  }));
  rpcMock.mockImplementation(async (_fn: string, args: { p_permission_key: string }) => {
    expect(args.p_permission_key).toBe("payments.connect");
    if (options.permissionError === "unexpected") throw new Error("db down");
    return options.permissionError === "denied"
      ? { data: null, error: { message: "denied" } }
      : { data: null, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  createOnboardingAccountLinkMock.mockResolvedValue({ url: "https://connect.stripe.com/fresh" });
});

describe("PaymentsRefreshPage", () => {
  it("redirects to /login when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    setup({});
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(createOnboardingAccountLinkMock).not.toHaveBeenCalled();
  });

  it("redirects to /account without a membership", async () => {
    setup({ membership: null });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/account");
  });

  it("redirects to the payments page without payments.connect and mints no link", async () => {
    setup({ permissionError: "denied", existing: { stripe_account_id: "acct_1" } });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/account/payments");
    expect(createOnboardingAccountLinkMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected permission errors", async () => {
    setup({ permissionError: "unexpected" });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("db down");
  });

  it("redirects back to the payments page when no account has been started yet", async () => {
    setup({ existing: null });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/account/payments");
    expect(createOnboardingAccountLinkMock).not.toHaveBeenCalled();
  });

  it("mints a fresh Account Link for the tenant's own account and redirects to it", async () => {
    setup({ existing: { stripe_account_id: "acct_1" } });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:https://connect.stripe.com/fresh");
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      { __fakeStripe: true },
      {
        accountId: "acct_1",
        returnUrl: "https://app.example.test/account/payments/return",
        refreshUrl: "https://app.example.test/account/payments/refresh",
      },
    );
  });

  it("falls back to localhost when NEXT_PUBLIC_APP_URL is unset", async () => {
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_APP_URL;
    setup({ existing: { stripe_account_id: "acct_1" } });
    const { default: Page } = await import("./page");
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(createOnboardingAccountLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ returnUrl: "http://localhost:3000/account/payments/return" }),
    );
  });
});

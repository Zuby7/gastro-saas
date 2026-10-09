import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const adminRpcMock = vi.fn();
const retrieveAccountMock = vi.fn();
const summarizeAccountMock = vi.fn();
const auditMock = vi.fn();
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
  createSupabaseAdminClient: () => ({ rpc: adminRpcMock }),
}));

vi.mock("@/lib/audit/record-menu-admin-audit-event", () => ({
  recordMenuAdminAuditEvent: (...args: unknown[]) => auditMock(...args),
}));

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({ __fakeStripe: true }),
}));

vi.mock("@/lib/stripe/connect", () => ({
  retrieveAccount: (...args: unknown[]) => retrieveAccountMock(...args),
  summarizeAccount: (...args: unknown[]) => summarizeAccountMock(...args),
}));

function setup(options: {
  membership?: { tenant_id: string; role: string } | null;
  existing?: { stripe_account_id: string; status: string } | null;
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
    expect(args.p_permission_key).toBe("payments.read");
    if (options.permissionError === "unexpected") throw new Error("db down");
    return options.permissionError === "denied"
      ? { data: null, error: { message: "denied" } }
      : { data: null, error: null };
  });
}

async function render(): Promise<string> {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page());
}

const snapshot = {
  status: "enabled",
  chargesEnabled: true,
  payoutsEnabled: true,
  requirementsSummary: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  retrieveAccountMock.mockResolvedValue({ id: "acct_1" });
  summarizeAccountMock.mockReturnValue(snapshot);
  adminRpcMock.mockResolvedValue({ data: null, error: null });
});

describe("PaymentsReturnPage", () => {
  it("redirects to /login when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    setup({});
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(retrieveAccountMock).not.toHaveBeenCalled();
  });

  it("redirects to /account without a membership", async () => {
    setup({ membership: null });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/account");
  });

  it("redirects to the payments page without payments.read and syncs nothing", async () => {
    setup({
      permissionError: "denied",
      existing: { stripe_account_id: "acct_1", status: "pending" },
    });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/account/payments");
    expect(adminRpcMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected permission errors", async () => {
    setup({ permissionError: "unexpected" });
    await expect(render()).rejects.toThrow("db down");
  });

  it("renders the confirmation without calling Stripe when no account exists", async () => {
    setup({ existing: null });
    const html = await render();
    expect(html).toContain("Stripe-Onboarding abgeschlossen");
    expect(html).toContain('href="/account/payments"');
    expect(retrieveAccountMock).not.toHaveBeenCalled();
    expect(adminRpcMock).not.toHaveBeenCalled();
  });

  it("re-fetches the account from Stripe and applies the snapshot via the admin RPC, auditing a status change", async () => {
    setup({ existing: { stripe_account_id: "acct_1", status: "pending" } });
    const html = await render();

    expect(html).toContain("Verbindungsstatus wurde aktualisiert");
    expect(retrieveAccountMock).toHaveBeenCalledWith({ __fakeStripe: true }, "acct_1");
    expect(adminRpcMock).toHaveBeenCalledWith(
      "apply_connect_account_snapshot",
      expect.objectContaining({
        p_stripe_account_id: "acct_1",
        p_status: "enabled",
        p_charges_enabled: true,
        p_payouts_enabled: true,
        p_requirements_summary: null,
        p_event_at: expect.any(String),
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        action: "payment_account.status_changed",
        metadata: { from: "pending", to: "enabled" },
      }),
    );
  });

  it("does not write an audit event when the status is unchanged", async () => {
    setup({ existing: { stripe_account_id: "acct_1", status: "enabled" } });
    await render();
    expect(adminRpcMock).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });
});

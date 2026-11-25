import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrderStatusByTokenMock = vi.fn();
const resolveTenantIdBySlugMock = vi.fn();
const reserveAndCheckRateLimitMock = vi.fn();
const retrieveSessionMock = vi.fn();
const createSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const paymentsSelectResult = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth/client-ip", () => ({ getClientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/auth/rate-limit", () => ({
  reserveAndCheckRateLimit: (...args: unknown[]) => reserveAndCheckRateLimitMock(...args),
}));
vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({}),
}));
vi.mock("@/lib/cart/service", () => ({
  resolveTenantIdBySlug: (...args: unknown[]) => resolveTenantIdBySlugMock(...args),
}));
vi.mock("@/lib/orders/service", () => ({
  getOrderStatusByToken: (...args: unknown[]) => getOrderStatusByTokenMock(...args),
}));
vi.mock("@/lib/orders/token", () => ({
  hashOrderAccessToken: (token: string) => `hashed-${token}`,
}));
vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
        create: (...args: unknown[]) => createSessionMock(...args),
      },
    },
  }),
}));
vi.mock("@/lib/audit/record-order-audit-event", () => ({ recordOrderAuditEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "order-1",
                    tenant_id: "tenant-1",
                    status: "awaiting_payment",
                    total_cents: 1500,
                    currency: "EUR",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({ returns: async () => paymentsSelectResult() }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

const awaitingOrder = {
  orderId: "order-1",
  tenantSlug: "demo",
  status: "awaiting_payment",
};

function emptyForm(): FormData {
  return new FormData();
}

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  getOrderStatusByTokenMock.mockResolvedValue(awaitingOrder);
  resolveTenantIdBySlugMock.mockResolvedValue("tenant-1");
  reserveAndCheckRateLimitMock.mockResolvedValue({ limited: false });
  paymentsSelectResult.mockReturnValue({
    data: [{ stripe_checkout_session_id: "cs_test_1", created_at: "2026-11-22T10:00:00Z" }],
    error: null,
  });
});

async function run(slug = "demo", token = "raw-token", form: FormData = emptyForm()) {
  const { retryPaymentAction } = await import("./actions");
  return retryPaymentAction(slug, token, {}, form);
}

describe("retryPaymentAction", () => {
  it("answers a wrong token with the generic not-found error", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(null);
    await expect(run()).resolves.toEqual({ error: "Bestellung nicht gefunden." });
    expect(getOrderStatusByTokenMock).toHaveBeenCalledWith("hashed-raw-token");
    expect(retrieveSessionMock).not.toHaveBeenCalled();
  });

  it("answers a slug mismatch with the same generic not-found error", async () => {
    await expect(run("other-restaurant")).resolves.toEqual({ error: "Bestellung nicht gefunden." });
    expect(retrieveSessionMock).not.toHaveBeenCalled();
  });

  it("rejects an order that is not awaiting payment", async () => {
    getOrderStatusByTokenMock.mockResolvedValue({ ...awaitingOrder, status: "received" });
    const result = await run();
    expect(result.error).toMatch(/nicht mehr/);
    expect(retrieveSessionMock).not.toHaveBeenCalled();
  });

  it("applies the rate limit", async () => {
    reserveAndCheckRateLimitMock.mockResolvedValue({ limited: true });
    const result = await run();
    expect(result.error).toMatch(/Zu viele/);
    expect(reserveAndCheckRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "checkout", email: "order-1" }),
    );
    expect(retrieveSessionMock).not.toHaveBeenCalled();
  });

  it("ignores any amount or id smuggled into the FormData", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "open", url: "https://checkout.stripe.com/x" });
    const form = new FormData();
    form.set("amount", "1");
    form.set("orderId", "someone-elses-order");
    form.set("sessionId", "cs_evil");

    await expect(run("demo", "raw-token", form)).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.com/x",
    );
    expect(retrieveSessionMock).toHaveBeenCalledWith("cs_test_1");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("redirects only to the Stripe URL of an open session", async () => {
    retrieveSessionMock.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    await expect(run()).rejects.toThrow("NEXT_REDIRECT:https://checkout.stripe.com/c/pay/cs_test_1");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("shows the expiry outcome and never creates a session for an expired session", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "expired", url: null });
    await expect(run()).resolves.toEqual({ outcome: "expired" });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns a retryable error and creates nothing when Stripe retrieve throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    retrieveSessionMock.mockRejectedValue(new Error("rate limited"));
    const result = await run();
    expect(result.error).toMatch(/erneut/);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("does not redirect for a completed session and reports it as being confirmed", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "complete", url: null });
    await expect(run()).resolves.toEqual({ outcome: "confirming" });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

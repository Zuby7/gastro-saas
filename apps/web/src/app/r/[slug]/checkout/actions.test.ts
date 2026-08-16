import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const createOrderFromCartMock = vi.fn();
const recordOrderAuditEventMock = vi.fn();
const writeOrderAccessTokenCookieMock = vi.fn();
const isTenantChargeReadyMock = vi.fn();
const createCheckoutSessionForOrderMock = vi.fn();
const redirectMock = vi.fn((target: string) => {
  // Next's real redirect() signals control flow via a thrown, special
  // NEXT_REDIRECT error that Next's own machinery catches further up the
  // tree -- checkoutAction relies on that (see its own comment about not
  // letting a generic catch swallow it), so the mock must throw too, not
  // just record the call, for the action's control flow to behave the same
  // way it does in production.
  throw new Error(`NEXT_REDIRECT:${target}`);
});

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: async () => "203.0.113.20",
}));

vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({
    reserveAttempt: reserveAttemptMock,
    markSucceeded: markSucceededMock,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/lib/cart/service", () => ({
  resolveGuestCartContext: async () => ({ tenantId: "tenant-1", cartId: "cart-1" }),
}));

vi.mock("@/lib/orders/cookie", () => ({
  writeOrderAccessTokenCookie: (...args: unknown[]) => writeOrderAccessTokenCookieMock(...args),
}));

vi.mock("@/lib/orders/service", () => ({
  createOrderFromCart: (...args: unknown[]) => createOrderFromCartMock(...args),
}));

vi.mock("@/lib/orders/token", () => ({
  createOrderAccessToken: () => "raw-token",
  hashOrderAccessToken: () => "hashed-token",
}));

vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => recordOrderAuditEventMock(...args),
}));

vi.mock("@/lib/payments/service", () => ({
  isTenantChargeReady: (...args: unknown[]) => isTenantChargeReadyMock(...args),
  createCheckoutSessionForOrder: (...args: unknown[]) => createCheckoutSessionForOrderMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => redirectMock(target),
}));

function validFormData(): FormData {
  const fd = new FormData();
  fd.set("fulfillmentType", "pickup");
  fd.set("customerName", "Max Mustermann");
  fd.set("customerPhone", "");
  fd.set("tableIdentifier", "");
  fd.set("customerNote", "");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 });
  createOrderFromCartMock.mockResolvedValue({
    orderId: "order-1",
    status: "awaiting_payment",
    totalCents: 1000,
    currency: "EUR",
  });
  isTenantChargeReadyMock.mockResolvedValue(true);
  createCheckoutSessionForOrderMock.mockResolvedValue({
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
  });
});

describe("checkoutAction", () => {
  it("never calls markSucceeded, even on a successful checkout (finding 2: successful checkouts must count toward the limit)", async () => {
    const { checkoutAction } = await import("./actions");

    // A successful checkout ends in redirect() -- which throws by design
    // (see actions.ts's own comment) -- rather than returning state with an
    // `order` field; CheckoutFormState only ever carries `error`. The
    // redirect target is Stripe's own hosted checkout URL, never the
    // order-status page directly (ticket #24) -- reaching Stripe is not
    // proof of payment either way.
    await expect(checkoutAction("demo", {}, validFormData())).rejects.toThrow("NEXT_REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
    expect(createCheckoutSessionForOrderMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      tenantSlug: "demo",
      orderId: "order-1",
      guestAccessToken: "raw-token",
    });
    expect(markSucceededMock).not.toHaveBeenCalled();
  });

  it("rejects checkout up front, without creating an order, when the tenant's Stripe Connect account isn't charge-ready", async () => {
    isTenantChargeReadyMock.mockResolvedValue(false);

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toContain("keine Kartenzahlungen entgegennehmen");
    expect(createOrderFromCartMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrderMock).not.toHaveBeenCalled();
  });

  it("surfaces a generic, translated error (never the raw internal error message) and never redirects if payment-session creation fails after order creation (issue #96)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createCheckoutSessionForOrderMock.mockRejectedValue(
      new Error("Stripe API key invalid: sk_live_xxx rejected by connected account acct_internal"),
    );

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    // The raw internal error message must never reach the guest.
    expect(result.error).not.toContain("Stripe API key");
    expect(result.error).not.toContain("acct_internal");
    expect(result.error).toBe(
      "Die Bestellung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
    );
    expect(redirectMock).not.toHaveBeenCalled();
    // The real error is still logged server-side for diagnosis.
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("blocks further checkout attempts once the per-IP window is exhausted by prior *successful* checkouts", async () => {
    // Simulate the rate-limit store's real behavior: because markSucceeded()
    // is never called for the checkout scope, each successful attempt keeps
    // counting toward ipCount on every subsequent reserveAttempt() call --
    // this is the exact regression finding 2 fixes (previously,
    // markSucceeded() would have excluded these from the count).
    reserveAttemptMock.mockResolvedValue({
      attemptId: "attempt-11",
      ipCount: 11,
      ipEmailCount: 11,
    });

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toContain("Zu viele Bestellversuche");
    expect(createOrderFromCartMock).not.toHaveBeenCalled();
  });

  it("does not block a checkout still within the per-IP window", async () => {
    reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-9", ipCount: 9, ipEmailCount: 9 });

    const { checkoutAction } = await import("./actions");

    await expect(checkoutAction("demo", {}, validFormData())).rejects.toThrow("NEXT_REDIRECT:");
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
  });
});

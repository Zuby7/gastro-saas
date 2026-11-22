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

class FakeCheckoutDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutDomainError";
  }
}

vi.mock("@/lib/orders/service", () => ({
  createOrderFromCart: (...args: unknown[]) => createOrderFromCartMock(...args),
  CheckoutDomainError: FakeCheckoutDomainError,
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
  fd.set("acceptTerms", "on");
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

  it("still surfaces the specific, already-safe CheckoutDomainError message (e.g. empty cart) instead of the generic fallback (issue #96 regression guard)", async () => {
    createOrderFromCartMock.mockRejectedValue(
      new FakeCheckoutDomainError("Ihr Warenkorb ist leer."),
    );

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toBe("Ihr Warenkorb ist leer.");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("blocks further checkout attempts once the per-cart window is exhausted by prior *successful* checkouts", async () => {
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

  // Issue #204 (audit 2026-11): every guest on a restaurant's Wi-Fi shares
  // one public IP. The IP-only bucket must not refuse the eleventh order of
  // the hour from the whole dining room; only the (ip, cart) bucket is tight.
  it("does not block a different cart when the shared IP already placed more than 10 orders this hour", async () => {
    reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-11", ipCount: 11, ipEmailCount: 1 });

    const { checkoutAction } = await import("./actions");

    await expect(checkoutAction("demo", {}, validFormData())).rejects.toThrow("NEXT_REDIRECT:");
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
  });

  it("still allows the 120th checkout of the hour from one shared IP", async () => {
    reserveAttemptMock.mockResolvedValue({
      attemptId: "attempt-120",
      ipCount: 120,
      ipEmailCount: 1,
    });

    const { checkoutAction } = await import("./actions");

    await expect(checkoutAction("demo", {}, validFormData())).rejects.toThrow("NEXT_REDIRECT:");
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
  });

  // The IP-only bucket is explicit (120), not reserveAndCheckRateLimit's
  // default multiplier, and still a hard backstop against one source
  // cycling through many carts (Opus review finding on PR #101/#106).
  it("blocks a checkout once the IP-only count exceeds its own threshold, even for a fresh cart", async () => {
    reserveAttemptMock.mockResolvedValue({
      attemptId: "attempt-121",
      ipCount: 121,
      ipEmailCount: 1,
    });

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toContain("Zu viele Bestellversuche");
    expect(createOrderFromCartMock).not.toHaveBeenCalled();
  });

  it("keeps the (ip, cart) bucket tight: the 11th attempt for the same cart is blocked even on a quiet IP", async () => {
    reserveAttemptMock.mockResolvedValue({
      attemptId: "attempt-11",
      ipCount: 11,
      ipEmailCount: 11,
    });

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toContain("Zu viele Bestellversuche");
    expect(createOrderFromCartMock).not.toHaveBeenCalled();
    expect(isTenantChargeReadyMock).not.toHaveBeenCalled();
  });

  it("does not block a checkout still within both windows", async () => {
    reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-9", ipCount: 9, ipEmailCount: 9 });

    const { checkoutAction } = await import("./actions");

    await expect(checkoutAction("demo", {}, validFormData())).rejects.toThrow("NEXT_REDIRECT:");
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
  });

  // Ticket #146: explicit AGB/Datenschutz consent is required server-side,
  // not just enforced by the checkbox's `required` HTML attribute.
  it("rejects checkout when the AGB/Datenschutz consent checkbox was not accepted", async () => {
    const fd = validFormData();
    fd.set("acceptTerms", "");

    const { checkoutAction } = await import("./actions");
    const result = await checkoutAction("demo", {}, fd);

    expect(result.error).toContain("akzeptieren");
    expect(createOrderFromCartMock).not.toHaveBeenCalled();
  });
});

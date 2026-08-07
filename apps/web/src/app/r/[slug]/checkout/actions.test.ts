import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const createOrderFromCartMock = vi.fn();
const recordOrderAuditEventMock = vi.fn();
const writeOrderAccessTokenCookieMock = vi.fn();

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

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
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
});

describe("checkoutAction", () => {
  it("never calls markSucceeded, even on a successful checkout (finding 2: successful checkouts must count toward the limit)", async () => {
    const { checkoutAction } = await import("./actions");

    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.order).toBeDefined();
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
    expect(markSucceededMock).not.toHaveBeenCalled();
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
    const result = await checkoutAction("demo", {}, validFormData());

    expect(result.error).toBeUndefined();
    expect(result.order).toBeDefined();
    expect(createOrderFromCartMock).toHaveBeenCalledOnce();
  });
});

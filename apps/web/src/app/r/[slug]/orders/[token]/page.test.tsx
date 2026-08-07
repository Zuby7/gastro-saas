import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderStatusView } from "@/lib/orders/types";

const getPublicMenuMock = vi.fn();
const getOrderStatusByTokenMock = vi.fn();

vi.mock("@/lib/public-menu/fetch", () => ({
  getPublicMenu: (...args: unknown[]) => getPublicMenuMock(...args),
}));

vi.mock("@/lib/orders/service", () => ({
  getOrderStatusByToken: (...args: unknown[]) => getOrderStatusByTokenMock(...args),
}));

vi.mock("@/lib/orders/token", () => ({
  hashOrderAccessToken: (token: string) => `hashed-${token}`,
}));

// The client-side polling component is exercised separately in
// `./order-status-live.test.tsx`; keep this suite focused on the server
// component's rendering/authorization logic.
vi.mock("./actions", () => ({
  pollOrderStatus: vi.fn().mockResolvedValue(null),
}));

function buildOrder(overrides: Partial<OrderStatusView> = {}): OrderStatusView {
  return {
    orderId: "order-1",
    tenantSlug: "demo",
    status: "received",
    fulfillmentType: "pickup",
    tableIdentifier: null,
    customerName: "Max Mustermann",
    customerNote: "",
    totalCents: 1500,
    currency: "EUR",
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:00.000Z",
    items: [],
    statusHistory: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPublicMenuMock.mockResolvedValue({ tenant: { name: "Demo Restaurant" } });
});

/**
 * Epic-6 batch review coverage:
 * - finding 2: semantic-structure a11y coverage for the order-status page's
 *   "order not found" state (a real, existing screen, not just the happy
 *   path).
 * - finding 3: the resolved order's `tenantSlug` must match the route's
 *   `[slug]` segment, rendering the exact same generic not-found state on a
 *   mismatch as an actually-invalid token (no distinguishable response).
 */
describe("OrderStatusPage", () => {
  it("renders the generic not-found state for a token that resolves to no order", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(null);
    const { default: OrderStatusPage } = await import("./page");

    render(
      await OrderStatusPage({
        params: Promise.resolve({ slug: "demo", token: "bad-token" }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Bestellung nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Aktueller Status")).not.toBeInTheDocument();
  });

  it("renders the same generic not-found state (never a distinguishable message) when the token's tenant doesn't match the route slug", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder({ tenantSlug: "other-restaurant" }));
    const { default: OrderStatusPage } = await import("./page");

    render(
      await OrderStatusPage({
        params: Promise.resolve({ slug: "demo", token: "valid-token-for-other-tenant" }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Bestellung nicht gefunden" }),
    ).toBeInTheDocument();
    // Same copy as the "no order at all" case -- no hint that the token was
    // valid for a different tenant.
    expect(
      screen.getByText(
        "Für diesen Link konnte keine Bestellung gefunden werden. Bitte prüfen Sie den Link aus Ihrer Bestellbestätigung.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the full status page with the expected heading hierarchy when the token's tenant matches the route slug", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder());
    const { default: OrderStatusPage } = await import("./page");

    render(
      await OrderStatusPage({
        params: Promise.resolve({ slug: "demo", token: "valid-token" }),
      }),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Bestellstatus" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Details" })).toBeInTheDocument();
    expect(screen.getByText("Bestellung eingegangen")).toBeInTheDocument();
  });
});

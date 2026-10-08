import { render, screen, within } from "@testing-library/react";
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

function buildOrder(overrides: Partial<OrderStatusView> = {}): OrderStatusView {
  return {
    orderId: "order-1",
    tenantSlug: "demo",
    status: "received",
    fulfillmentType: "pickup",
    tableIdentifier: null,
    customerName: "Max Mustermann",
    customerNote: "",
    totalCents: 2750,
    currency: "EUR",
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:05:00.000Z",
    items: [
      {
        dishName: "Pizza Margherita",
        variantName: "Groß",
        quantity: 2,
        unitPriceCents: 1100,
        selections: [{ name: "Extra Käse", priceDeltaCents: 100 }],
      },
      {
        dishName: "Cola",
        variantName: null,
        quantity: 1,
        unitPriceCents: 550,
        selections: [],
      },
    ],
    statusHistory: [
      { status: "awaiting_payment", occurredAt: "2026-08-08T10:00:00.000Z" },
      { status: "received", occurredAt: "2026-08-08T10:02:00.000Z" },
    ],
    rating: null,
    ...overrides,
  };
}

async function renderReceipt(slug: string, token: string) {
  const { default: ReceiptPage } = await import("./page");
  render(await ReceiptPage({ params: Promise.resolve({ slug, token }) }));
}

const NOT_FOUND_COPY =
  "Für diesen Link konnte keine Bestellung gefunden werden. Bitte prüfen Sie den Link aus Ihrer Bestellbestätigung.";

beforeEach(() => {
  vi.clearAllMocks();
  getPublicMenuMock.mockResolvedValue({ tenant: { name: "Demo Restaurant" } });
});

describe("ReceiptPage", () => {
  it("renders the receipt with server-side totals for a paid order", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder());
    await renderReceipt("demo", "valid-token");

    expect(getOrderStatusByTokenMock).toHaveBeenCalledWith("hashed-valid-token");
    expect(screen.getByText("Demo Restaurant")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Digitaler Bestellbeleg" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Online bezahlt")).toBeInTheDocument();
    expect(screen.getByText("Bezahlt am")).toBeInTheDocument();
    expect(screen.getByText("Abholung")).toBeInTheDocument();
    expect(screen.getByText(/2× Pizza Margherita \(Groß\)/)).toBeInTheDocument();
    expect(screen.getByText("Extra Käse")).toBeInTheDocument();

    const table = screen.getByRole("table");
    // 2 x 11,00 EUR line total and the server's order total.
    expect(within(table).getByText(/22,00/)).toBeInTheDocument();
    const total = screen.getByText("Gesamtsumme").parentElement as HTMLElement;
    expect(total).toHaveTextContent(/27,50/);
  });

  it("shows the legal note and the print button", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder());
    await renderReceipt("demo", "valid-token");

    expect(
      screen.getByText("Digitaler Bestellbeleg – kein steuerlich qualifizierter Kassenbeleg."),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Beleg drucken / als PDF speichern" });
    expect(button).toHaveClass("print:hidden");
  });

  it("marks navigation as print-hidden and uses print-friendly container classes", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder());
    await renderReceipt("demo", "valid-token");

    expect(screen.getByRole("navigation", { name: "Navigation" })).toHaveClass("print:hidden");
    expect(screen.getByRole("main")).toHaveClass("print:bg-surface");
  });

  it.each(["awaiting_payment", "cancelled"] as const)(
    "shows no receipt for a %s order",
    async (status) => {
      getOrderStatusByTokenMock.mockResolvedValue(buildOrder({ status }));
      await renderReceipt("demo", "valid-token");

      expect(
        screen.getByRole("heading", { level: 1, name: "Noch kein Beleg verfügbar" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText("Online bezahlt")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("renders the generic not-found state for an unknown token", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(null);
    await renderReceipt("demo", "bad-token");

    expect(
      screen.getByRole("heading", { level: 1, name: "Bestellung nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the identical generic not-found state for another tenant's token under the wrong slug (cross-tenant)", async () => {
    getOrderStatusByTokenMock.mockResolvedValue(buildOrder({ tenantSlug: "other-restaurant" }));
    await renderReceipt("demo", "token-of-other-tenant");

    expect(
      screen.getByRole("heading", { level: 1, name: "Bestellung nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Pizza Margherita")).not.toBeInTheDocument();
    expect(screen.queryByText("Online bezahlt")).not.toBeInTheDocument();
  });
});

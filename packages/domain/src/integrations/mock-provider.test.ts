import { describe, expect, it } from "vitest";
import { createMockIntegrationProvider } from "./mock-provider";
import type { MenuSnapshot } from "./provider";

const FIXED_NOW = new Date("2026-08-20T09:00:00.000Z");

function buildProvider(ids: string[] = ["id-1"]) {
  let call = 0;
  return createMockIntegrationProvider({
    now: () => FIXED_NOW,
    generateId: () => ids[call++] ?? `fallback-${call}`,
  });
}

const menu: MenuSnapshot = {
  tenantSlug: "trattoria-bella",
  categories: [
    {
      id: "cat-1",
      name: "Pizza",
      dishes: [
        { id: "dish-1", name: "Margherita", priceCents: 900, currency: "EUR" },
        { id: "dish-2", name: "Salami", priceCents: 1100, currency: "EUR" },
      ],
    },
    {
      id: "cat-2",
      name: "Getränke",
      dishes: [{ id: "dish-3", name: "Cola", priceCents: 300, currency: "EUR" }],
    },
  ],
};

const emptyMenu: MenuSnapshot = { tenantSlug: "empty-restaurant", categories: [] };

describe("createMockIntegrationProvider (ticket #38)", () => {
  it("exportMenu: summarizes category/dish counts and embeds the full snapshot in the payload", () => {
    const provider = buildProvider();
    const result = provider.exportMenu(menu);

    expect(result.categoryCount).toBe(2);
    expect(result.dishCount).toBe(3);
    expect(result.exportedAt).toBe(FIXED_NOW.toISOString());
    expect(result.payload).toMatchObject({
      provider: "mock",
      tenantSlug: "trattoria-bella",
      categories: menu.categories,
    });
  });

  it("exportMenu: never leaks another tenant's data -- output depends only on the passed-in snapshot", () => {
    const provider = buildProvider();
    const result = provider.exportMenu(emptyMenu);

    expect(result.categoryCount).toBe(0);
    expect(result.dishCount).toBe(0);
    expect(result.payload).toMatchObject({ tenantSlug: "empty-restaurant", categories: [] });
  });

  it("simulateIncomingOrder: acceptance criterion 1 -- triggers a simulated incoming order referencing a real published dish", () => {
    const provider = buildProvider(["order-id-1"]);
    const result = provider.simulateIncomingOrder(menu);

    expect(result.externalOrderId).toBe("mock-order-order-id-1");
    expect(result.receivedAt).toBe(FIXED_NOW.toISOString());
    expect(result.payload).toMatchObject({
      provider: "mock",
      tenantSlug: "trattoria-bella",
      externalOrderId: "mock-order-order-id-1",
      items: [{ dishId: "dish-1", name: "Margherita", quantity: 1 }],
    });
  });

  it("simulateIncomingOrder: an empty published menu still produces a valid (itemless) simulated order", () => {
    const provider = buildProvider(["order-id-2"]);
    const result = provider.simulateIncomingOrder(emptyMenu);

    expect(result.externalOrderId).toBe("mock-order-order-id-2");
    expect(result.payload).toMatchObject({ items: [] });
  });

  it("confirmOrder: acknowledges the given external order id as confirmed", () => {
    const provider = buildProvider();
    const result = provider.confirmOrder("mock-order-abc");

    expect(result).toEqual({
      externalOrderId: "mock-order-abc",
      confirmedAt: FIXED_NOW.toISOString(),
      payload: { provider: "mock", externalOrderId: "mock-order-abc", status: "confirmed" },
    });
  });
});

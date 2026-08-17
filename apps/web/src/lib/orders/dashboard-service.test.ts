import { describe, expect, it } from "vitest";
import {
  ORDER_DASHBOARD_STATUSES,
  groupOrdersByStatus,
  type TenantOrderRow,
} from "./dashboard-service";

function order(overrides: Partial<TenantOrderRow>): TenantOrderRow {
  return {
    id: overrides.id ?? "order-1",
    status: overrides.status ?? "received",
    fulfillmentType: "pickup",
    customerName: "Max Mustermann",
    tableIdentifier: null,
    totalCents: 1000,
    currency: "EUR",
    createdAt: "2026-08-17T10:00:00.000Z",
    paymentStatus: "paid",
    ...overrides,
  };
}

describe("ORDER_DASHBOARD_STATUSES", () => {
  it("excludes awaiting_payment -- an order that hasn't completed payment isn't shown on the staff board", () => {
    expect(ORDER_DASHBOARD_STATUSES).not.toContain("awaiting_payment");
    expect(ORDER_DASHBOARD_STATUSES).toEqual([
      "received",
      "accepted",
      "preparing",
      "ready",
      "completed",
      "cancelled",
    ]);
  });
});

describe("groupOrdersByStatus", () => {
  it("groups orders into their matching status column, preserving column order", () => {
    const orders = [
      order({ id: "a", status: "preparing" }),
      order({ id: "b", status: "received" }),
      order({ id: "c", status: "received" }),
    ];

    const grouped = groupOrdersByStatus(orders);

    expect(Object.keys(grouped)).toEqual([...ORDER_DASHBOARD_STATUSES]);
    expect(grouped.received.map((o) => o.id)).toEqual(["b", "c"]);
    expect(grouped.preparing.map((o) => o.id)).toEqual(["a"]);
    expect(grouped.ready).toEqual([]);
    expect(grouped.completed).toEqual([]);
    expect(grouped.cancelled).toEqual([]);
  });

  it("returns every column, even ones with zero orders", () => {
    const grouped = groupOrdersByStatus([]);
    for (const status of ORDER_DASHBOARD_STATUSES) {
      expect(grouped[status]).toEqual([]);
    }
  });
});

import { describe, expect, it } from "vitest";
import { describeOrderChanges } from "./dashboard-diff";
import type { TenantOrderRow } from "./dashboard-service";

function order(overrides: Partial<TenantOrderRow> = {}): TenantOrderRow {
  return {
    id: "order-1",
    status: "received",
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

describe("describeOrderChanges", () => {
  it("returns null when nothing changed between polls", () => {
    const previous = [order()];
    const next = [order()];
    expect(describeOrderChanges(previous, next)).toBeNull();
  });

  it("announces a brand-new order that wasn't present in the previous poll", () => {
    const previous: TenantOrderRow[] = [];
    const next = [order({ id: "order-2", customerName: "Erika Musterfrau", status: "received" })];

    const announcement = describeOrderChanges(previous, next);
    expect(announcement).toContain("Neue Bestellung von Erika Musterfrau");
    expect(announcement).toContain("Neu");
  });

  it("announces a status change on an already-known order", () => {
    const previous = [order({ status: "received" })];
    const next = [order({ status: "preparing" })];

    const announcement = describeOrderChanges(previous, next);
    expect(announcement).toContain("Max Mustermann");
    expect(announcement).toContain("Neu");
    expect(announcement).toContain("In Zubereitung");
  });

  it("combines multiple simultaneous changes into a single announcement", () => {
    const previous = [
      order({ id: "order-1", status: "received" }),
    ];
    const next = [
      order({ id: "order-1", status: "accepted" }),
      order({ id: "order-2", customerName: "Neuer Kunde", status: "received" }),
    ];

    const announcement = describeOrderChanges(previous, next);
    expect(announcement).toContain("Angenommen");
    expect(announcement).toContain("Neuer Kunde");
  });

  it("does not announce orders that disappeared from the list (e.g. paginated out) as changes", () => {
    const previous = [order({ id: "order-1" }), order({ id: "order-2" })];
    const next = [order({ id: "order-1" })];

    expect(describeOrderChanges(previous, next)).toBeNull();
  });
});

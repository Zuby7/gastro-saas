import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@gastro-saas/domain";
import {
  ORDER_STATUS_ACTION_LABELS,
  orderStatusActionLabel,
  orderStatusDescription,
  orderStatusLabel,
  paymentStatusLabel,
  staffOrderStatusColumnLabel,
} from "./status-labels";

const ALL: OrderStatus[] = [
  "awaiting_payment",
  "received",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
];

describe("order status labels", () => {
  it.each(ALL)("%s has non-empty customer label, description and staff label", (status) => {
    expect(orderStatusLabel(status)).toBeTruthy();
    expect(orderStatusLabel(status)).not.toBe(status);
    expect(orderStatusDescription(status)).toBeTruthy();
    expect(staffOrderStatusColumnLabel(status)).toBeTruthy();
    expect(staffOrderStatusColumnLabel(status)).not.toBe(status);
  });

  it("falls back to the raw value / empty description for unknown statuses", () => {
    const unknown = "bogus" as OrderStatus;
    expect(orderStatusLabel(unknown)).toBe("bogus");
    expect(orderStatusDescription(unknown)).toBe("");
    expect(staffOrderStatusColumnLabel(unknown)).toBe("bogus");
  });

  it("only offers action labels for forward kitchen transitions", () => {
    expect(Object.keys(ORDER_STATUS_ACTION_LABELS).sort()).toEqual(
      ["accepted", "completed", "preparing", "ready"].sort(),
    );
    expect(orderStatusActionLabel("accepted")).toBe("Annehmen");
    expect(orderStatusActionLabel("cancelled")).toBe("cancelled");
  });

  it("labels payment statuses with a fallback", () => {
    expect(paymentStatusLabel("paid")).toBe("Bezahlt");
    expect(paymentStatusLabel("unpaid")).toBe("Nicht bezahlt");
    expect(paymentStatusLabel("weird")).toBe("weird");
  });
});

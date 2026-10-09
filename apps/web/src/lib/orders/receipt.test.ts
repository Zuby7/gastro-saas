import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@gastro-saas/domain";
import { isOrderPaidStatus } from "./receipt";

describe("isOrderPaidStatus", () => {
  it.each<[OrderStatus, boolean]>([
    ["awaiting_payment", false],
    ["received", true],
    ["accepted", true],
    ["preparing", true],
    ["ready", true],
    ["completed", true],
    ["cancelled", false],
  ])("%s -> %s", (status, expected) => {
    expect(isOrderPaidStatus(status)).toBe(expected);
  });
});

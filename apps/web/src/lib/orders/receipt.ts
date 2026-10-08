import type { OrderStatus } from "@gastro-saas/domain";

/**
 * Statuses an order can only reach after the verified payment webhook moved
 * it out of `awaiting_payment` (ticket #153). `cancelled` is deliberately
 * excluded (may be unpaid or refunded) -- no receipt is shown for it.
 */
const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "received",
  "accepted",
  "preparing",
  "ready",
  "completed",
]);

export function isOrderPaidStatus(status: OrderStatus): boolean {
  return PAID_STATUSES.has(status);
}

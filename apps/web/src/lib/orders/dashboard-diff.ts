import { staffOrderStatusColumnLabel } from "./status-labels";
import type { TenantOrderRow } from "./dashboard-service";

/**
 * Pure diffing logic behind the staff order dashboard's `aria-live` region
 * (ticket #27's "Statuswechsel für Screenreader ansagbar" acceptance
 * criterion). Extracted from the client polling component so it can be unit
 * tested directly without mounting React or a browser -- mirrors this
 * repo's "canonical pure representation, unit tested directly" pattern used
 * by `packages/domain/src/orders/state-machine.ts`.
 *
 * Compares the previous poll's orders against the latest poll's orders and
 * produces a short, human-readable German announcement for every new order
 * that appeared and every status change on an order that was already known
 * -- an `aria-live="polite"` region only re-announces when its text content
 * actually changes, so returning `null` for "nothing changed" avoids the
 * region silently re-announcing identical text on every poll interval.
 */
export function describeOrderChanges(
  previousOrders: TenantOrderRow[],
  nextOrders: TenantOrderRow[],
): string | null {
  const previousById = new Map(previousOrders.map((order) => [order.id, order.status]));
  const announcements: string[] = [];

  for (const order of nextOrders) {
    const previousStatus = previousById.get(order.id);
    if (previousStatus === undefined) {
      announcements.push(
        `Neue Bestellung von ${order.customerName} (${staffOrderStatusColumnLabel(order.status)}).`,
      );
    } else if (previousStatus !== order.status) {
      announcements.push(
        `Bestellung von ${order.customerName}: ${staffOrderStatusColumnLabel(previousStatus)} → ${staffOrderStatusColumnLabel(order.status)}.`,
      );
    }
  }

  return announcements.length > 0 ? announcements.join(" ") : null;
}

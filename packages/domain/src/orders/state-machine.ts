// Order status state machine (Epic 6, ticket #21).
//
// This is the canonical, pure representation of the valid order status
// transitions -- mirrored at the database layer by
// `is_valid_order_status_transition()` / the `order_status_events_validate`
// trigger (see supabase/migrations/*_orders_state_machine_and_checkout.sql),
// which is the actual source-of-truth enforcement point (this repo's
// "two enforcement layers" philosophy: application logic + a DB-level guard,
// neither alone is sufficient -- see
// supabase/migrations/20260801110000_restaurant_profile_and_menu_management.sql's
// `guard_menu_versions_status_change()` for the established precedent this
// mirrors). This module is intentionally free of any DB/IO dependency so it
// can be unit tested directly, per the ticket's "Unit-Test Zustandsmaschine"
// requirement.
//
// Transition table (documented rationale):
// - `awaiting_payment -> received`: Epic 7 owns real payment processing: a
//   later ticket flips this once a verified webhook confirms payment. This
//   ticket (#21) only creates orders in `awaiting_payment`, ahead of that
//   step (see this ticket's "Auswirkungen" note).
// - `received -> accepted -> preparing -> ready -> completed`: strictly
//   forward-only kitchen/service workflow (Epic 8) -- no step may be
//   skipped (e.g. `received -> completed`) and no step may go backwards
//   (e.g. `ready -> received`).
// - `cancelled` is reachable from every state up through `preparing`
//   (a guest or staff can still call off an order that hasn't been handed
//   over yet), but deliberately NOT from `ready` or `completed`: once food
//   is ready/served, cancellation is no longer a status transition (any
//   real-world "undo" at that point, e.g. a refund, is a separate concern
//   for Epic 7's refund ticket, not a state machine transition).
// - `completed` and `cancelled` are terminal: no transitions leave them.
export const ORDER_STATUSES = [
  "awaiting_payment",
  "received",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Every status's allowed *next* statuses. `null` (used as the map key via
 * {@link isValidOrderStatusTransition}'s `from` parameter) represents order
 * creation -- the only valid "transition" from no prior status is into
 * `awaiting_payment`.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["received", "cancelled"],
  received: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
};

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * `from === null` represents the initial creation of an order (no prior
 * status yet) -- the only valid target is `awaiting_payment`.
 */
export function isValidOrderStatusTransition(
  from: OrderStatus | null,
  to: OrderStatus,
): boolean {
  if (from === null) {
    return to === "awaiting_payment";
  }
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Throws a descriptive error for an invalid transition instead of returning
 * a boolean -- convenient for call sites that want to fail fast (application
 * code sitting in front of the DB-level guard, which is the actual
 * authoritative enforcement point).
 */
export function assertValidOrderStatusTransition(from: OrderStatus | null, to: OrderStatus): void {
  if (!isValidOrderStatusTransition(from, to)) {
    throw new Error(`Invalid order status transition: ${from ?? "(new order)"} -> ${to}`);
  }
}

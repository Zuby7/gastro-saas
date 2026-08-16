import type { OrderStatus } from "@gastro-saas/domain";

/**
 * Customer-friendly German labels for the guest-facing order-status page
 * (ticket #22) -- distinct from any future staff-facing kitchen dashboard
 * copy (Epic 8), which may want more operational wording.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Zahlung ausstehend",
  received: "Bestellung eingegangen",
  accepted: "Bestellung angenommen",
  preparing: "Wird zubereitet",
  ready: "Bereit",
  completed: "Abgeschlossen",
  cancelled: "Storniert",
};

/** A short, customer-facing sentence describing what the current status means. */
export const ORDER_STATUS_DESCRIPTIONS: Record<OrderStatus, string> = {
  awaiting_payment: "Wir warten noch auf die Zahlungsbestätigung für Ihre Bestellung.",
  received: "Das Restaurant hat Ihre Bestellung erhalten.",
  accepted: "Das Restaurant hat Ihre Bestellung angenommen.",
  preparing: "Ihre Bestellung wird gerade in der Küche zubereitet.",
  ready: "Ihre Bestellung ist fertig.",
  completed: "Ihre Bestellung wurde abgeschlossen.",
  cancelled: "Diese Bestellung wurde storniert.",
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function orderStatusDescription(status: OrderStatus): string {
  return ORDER_STATUS_DESCRIPTIONS[status] ?? "";
}

/**
 * Staff-facing board column headings for the live order dashboard (ticket
 * #27) -- distinct wording from the customer-facing labels above, matching
 * the ticket's own "neue/angenommene/in Zubereitung/fertige/abgeschlossene/
 * stornierte" column names. `awaiting_payment` has no column (the dashboard
 * never shows it, see `dashboard-service.ts`'s `ORDER_DASHBOARD_STATUSES`)
 * but still needs an entry here since the type is `Record<OrderStatus, ...>`.
 */
export const STAFF_ORDER_STATUS_COLUMN_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Zahlung ausstehend",
  received: "Neu",
  accepted: "Angenommen",
  preparing: "In Zubereitung",
  ready: "Fertig",
  completed: "Abgeschlossen",
  cancelled: "Storniert",
};

export function staffOrderStatusColumnLabel(status: OrderStatus): string {
  return STAFF_ORDER_STATUS_COLUMN_LABELS[status] ?? status;
}

/** German labels for the narrow `orders.read`-gated payment-status projection (see `dashboard-service.ts`). */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Nicht bezahlt",
  processing: "Zahlung offen",
  paid: "Bezahlt",
  partially_refunded: "Teilweise erstattet",
  refunded: "Erstattet",
  failed: "Zahlung fehlgeschlagen",
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

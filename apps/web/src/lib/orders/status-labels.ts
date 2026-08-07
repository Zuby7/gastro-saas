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

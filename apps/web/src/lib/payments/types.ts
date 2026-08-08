/**
 * Order snapshot fields this ticket needs to create a Stripe Checkout
 * Session. Deliberately a small, explicit projection of `orders` (never a
 * `select *`) -- see `apps/web/src/lib/payments/service.ts`.
 */
export interface OrderPaymentSnapshot {
  orderId: string;
  tenantId: string;
  status: string;
  totalCents: number;
  currency: string;
}

export interface CreateCheckoutSessionInput {
  tenantId: string;
  tenantSlug: string;
  orderId: string;
  guestAccessToken: string;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
}

/**
 * Thrown when the tenant's Stripe Connect account isn't ready to accept
 * charges (no `payment_accounts` row yet, or `charges_enabled = false`) --
 * callers must reject checkout with a clear, distinguishable error rather
 * than silently creating an order that can never be paid.
 */
export class PaymentAccountNotReadyError extends Error {
  constructor(message = "Zahlungsannahme für dieses Restaurant ist derzeit nicht verfügbar.") {
    super(message);
    this.name = "PaymentAccountNotReadyError";
  }
}

/**
 * Issue #88: the awaiting-payment timeout sweep's default timeout, in
 * minutes. Kept in sync manually with `p_timeout_minutes default 30` in
 * `supabase/migrations/20260905130000_awaiting_payment_timeout_sweep.sql`'s
 * `sweep_stale_awaiting_payment_orders()` (a plain SQL default, not a
 * runtime-configurable setting -- see that migration's header) -- this
 * constant lets `createCheckoutSessionForOrder()` set Stripe's own
 * `expires_at` to line up with the same cutoff, so Stripe itself
 * auto-expires an unpaid Checkout Session around the same time the sweep
 * would cancel the underlying order, instead of leaving it payable for
 * Stripe's 24-hour default. If the migration's default ever changes, update
 * this constant to match.
 */
export const AWAITING_PAYMENT_TIMEOUT_MINUTES = 30;

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

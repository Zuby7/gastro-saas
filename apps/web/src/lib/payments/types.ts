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
 * Stripe hard-rejects `Checkout.Session.create()` with `expires_at` less than
 * 30 minutes in the future *at the moment Stripe processes the request* --
 * not at the moment this process computed `Date.now()`. Issue #88: computing
 * `expires_at` as exactly `AWAITING_PAYMENT_TIMEOUT_MINUTES * 60` seconds from
 * `Date.now()`, with no margin, risks landing under Stripe's 30-minute floor
 * once real network latency between this call and Stripe's request
 * processing is accounted for -- an `invalid_request_error` that mocked
 * tests can never catch. `createCheckoutSessionForOrder()` clamps the
 * timeout-derived seconds to at least this floor and adds
 * `CHECKOUT_EXPIRY_SAFETY_MARGIN_SECONDS` on top.
 */
export const STRIPE_MIN_CHECKOUT_EXPIRY_SECONDS = 30 * 60;

/**
 * Extra buffer added on top of the (clamped) timeout-derived expiry so a
 * realistic amount of request latency can never push the actual `expires_at`
 * Stripe receives below its 30-minute floor.
 */
export const CHECKOUT_EXPIRY_SAFETY_MARGIN_SECONDS = 60;

// Defense in depth: AWAITING_PAYMENT_TIMEOUT_MINUTES must never silently drop
// below Stripe's 30-minute floor for expires_at (see above) -- fail fast at
// module load rather than only in production Stripe API errors.
if (AWAITING_PAYMENT_TIMEOUT_MINUTES < 30) {
  throw new Error(
    "AWAITING_PAYMENT_TIMEOUT_MINUTES must be at least 30: Stripe rejects Checkout Session " +
      "expires_at values less than 30 minutes in the future.",
  );
}

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

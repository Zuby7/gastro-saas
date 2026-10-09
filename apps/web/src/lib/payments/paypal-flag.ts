/**
 * Server-side feature flag for PayPal via Stripe Connect (ADR-0003, PROPOSED).
 *
 * "1" = on, anything else/unset = off. When on, Checkout Sessions are created
 * WITHOUT `on_behalf_of` (Stripe rejects PayPal combined with it) while still
 * using `transfer_data.destination`. Read at call time, never exposed to the
 * browser as an env var -- the checkout page passes the boolean as a prop.
 */
export function isPaypalConnectEnabled(): boolean {
  return process.env.STRIPE_CONNECT_PAYPAL_ENABLED === "1";
}

import Stripe from "stripe";

/**
 * Server-only Stripe client factory (ticket #23). Mirrors
 * `createSupabaseAdminClient()`'s "privileged client isolated in its own
 * module" pattern -- `STRIPE_SECRET_KEY` must never reach the browser and
 * this module must never be imported from a Client Component.
 *
 * Hard test-mode gate: the secret key must start with `sk_test_` (or
 * `rk_test_` for a restricted test key). This isn't just documentation --
 * a live-mode key configured by mistake fails loudly here instead of
 * silently taking real payments, per `.claude/rules/payments.md` ("Stripe
 * test mode only until the user explicitly authorizes production
 * activation -- a hard gate, not a default to flip casually").
 */
export function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY must be set to use Stripe.");
  }

  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a Stripe TEST MODE key (sk_test_/rk_test_ prefix) -- " +
        "live-mode keys are refused until production activation is explicitly authorized.",
    );
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-07-29.dahlia",
  });
}

/**
 * Resolves the Stripe Connect webhook signing secret for the
 * account.updated receiving endpoint. Kept separate from ticket #25's
 * eventual payment-event webhook secret (`STRIPE_WEBHOOK_SECRET`) --
 * Connect events and platform payment events are configured as separate
 * Stripe webhook endpoints with separate signing secrets.
 */
export function getStripeConnectWebhookSecret(): string {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET must be set to verify Connect webhooks.");
  }

  return secret;
}

/**
 * Resolves the signing secret for ticket #25's platform-account **payment
 * events** webhook endpoint (`/api/webhooks/stripe`) -- deliberately a
 * distinct env var/Stripe webhook endpoint from
 * `getStripeConnectWebhookSecret()` above (see that function's comment and
 * `.env.example`).
 */
export function getStripePaymentsWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be set to verify the payments webhook.");
  }

  return secret;
}

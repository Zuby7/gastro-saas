import type Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordOrderAuditEvent } from "@/lib/audit/record-order-audit-event";
import {
  AWAITING_PAYMENT_TIMEOUT_MINUTES,
  CHECKOUT_EXPIRY_SAFETY_MARGIN_SECONDS,
  PaymentAccountNotReadyError,
  STRIPE_MIN_CHECKOUT_EXPIRY_SECONDS,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
  type OrderPaymentSnapshot,
} from "./types";

/**
 * Reads the tenant's Stripe Connect readiness (ticket #23's
 * `payment_accounts`, ADR-0002). Used both *before* order creation
 * (`apps/web/src/app/r/[slug]/checkout/actions.ts` -- reject checkout early
 * rather than create an unpayable order) and again immediately before
 * payment creation below -- the DB-level `ensure_payment_matches_order()`
 * trigger (see the payments migration) re-checks this a third,
 * unbypassable time on INSERT.
 */
export async function isTenantChargeReady(tenantId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("payment_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ stripe_account_id: string; charges_enabled: boolean }>();

  return Boolean(data?.charges_enabled);
}

async function fetchChargeReadyAccount(tenantId: string): Promise<{ stripeAccountId: string }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("payment_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ stripe_account_id: string; charges_enabled: boolean }>();

  if (!data || !data.charges_enabled) {
    throw new PaymentAccountNotReadyError();
  }

  return { stripeAccountId: data.stripe_account_id };
}

/**
 * Re-reads the order's own immutable, server-calculated snapshot
 * (`orders.total_cents`/`orders.currency`, guarded against drift by
 * `guard_orders_payment_fields_change()` since the moment
 * `create_order_from_cart()` created it) directly from the database --
 * never the caller's in-memory copy of that same value. This IS the
 * "serverseitige Neuberechnung unmittelbar vor Zahlungserstellung"
 * acceptance criterion: because the order's total is fixed and guarded at
 * creation time, re-deriving it fresh from that immutable row at
 * payment-creation time is equivalent to recalculating it, without
 * inventing a second, parallel total-calculation path that could drift from
 * the order's own guarded total (see the payments migration's header for
 * the same rationale, enforced a second time at the DB layer).
 */
async function fetchOrderPaymentSnapshot(
  tenantId: string,
  orderId: string,
): Promise<OrderPaymentSnapshot> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select("id, tenant_id, status, total_cents, currency")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      tenant_id: string;
      status: string;
      total_cents: number;
      currency: string;
    }>();

  if (error || !data) {
    throw new Error("Order not found for payment creation.");
  }

  return {
    orderId: data.id,
    tenantId: data.tenant_id,
    status: data.status,
    totalCents: data.total_cents,
    currency: data.currency,
  };
}

/**
 * Creates (or idempotently re-returns) a Stripe-hosted Checkout Session for
 * an order that was just created in `awaiting_payment` status, and persists
 * a `payments` row.
 *
 * - Destination charge, ADR-0002: `payment_intent_data.on_behalf_of` +
 *   `transfer_data.destination` both point at the tenant's connected
 *   account; no `application_fee_amount` in the MVP.
 * - No custom card form: `mode: 'payment'` with Stripe's own hosted
 *   Checkout page -- this module never collects or sees raw card data.
 * - Idempotent retry: the `Idempotency-Key` sent to Stripe is derived
 *   solely from the order's own unique, immutable id, so a retried call for
 *   the same order (double-submit, Server Action retry) is answered by
 *   Stripe with the *same* Checkout Session object rather than creating a
 *   second one (`.claude/rules/backend-api.md` "idempotency keys for any
 *   endpoint that can be safely retried (payment creation ...)"). The
 *   `payments.stripe_checkout_session_id` unique constraint is a second,
 *   DB-level belt-and-suspenders guard against ever recording two rows for
 *   the same Stripe session.
 * - This function never marks the order (or the payment row) "paid" -- see
 *   `types.ts`/the payments migration header. Only ticket #25's
 *   signature-verified webhook does that.
 */
export async function createCheckoutSessionForOrder(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const order = await fetchOrderPaymentSnapshot(input.tenantId, input.orderId);

  if (order.status !== "awaiting_payment") {
    throw new Error("This order is not awaiting payment.");
  }

  const { stripeAccountId } = await fetchChargeReadyAccount(input.tenantId);

  const stripe = createStripeClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const orderStatusUrl = `${origin}/r/${input.tenantSlug}/orders/${input.guestAccessToken}`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: order.totalCents,
          product_data: {
            name: `Bestellung ${order.orderId}`,
          },
        },
      },
    ],
    payment_intent_data: {
      on_behalf_of: stripeAccountId,
      transfer_data: {
        destination: stripeAccountId,
      },
    },
    // Reaching success_url is never proof of payment
    // (.claude/rules/payments.md) -- both success and cancel return the
    // guest to the same order-status page, which only ever reflects the
    // order's actual, webhook-driven status.
    success_url: `${orderStatusUrl}?checkout=success`,
    cancel_url: `${orderStatusUrl}?checkout=cancelled`,
    metadata: {
      tenant_id: input.tenantId,
      order_id: input.orderId,
    },
    // Issue #88: without this, Stripe defaults an unpaid Checkout Session to
    // stay payable for 24 hours -- long after the awaiting-payment timeout
    // sweep has already cancelled the underlying order (default 30 minutes,
    // see AWAITING_PAYMENT_TIMEOUT_MINUTES). Aligning Stripe's own expiry
    // with the sweep's timeout closes almost all of that window; the
    // webhook handler's `payment_after_order_cancelled_flagged` path is the
    // remaining safety net for the sweep's own cron interval.
    //
    // Stripe requires `expires_at` to be at least 30 minutes in the future
    // *when Stripe processes the request*, not when this line ran -- an
    // exact `Date.now() + 30*60` computed here, with zero margin, risks
    // landing under that floor once real network latency is accounted for,
    // producing a hard `invalid_request_error` in production (mocked
    // Stripe client in tests, so CI can never catch this). Clamp the
    // timeout-derived seconds to Stripe's own floor and add a fixed safety
    // margin on top.
    expires_at:
      Math.floor(Date.now() / 1000) +
      Math.max(AWAITING_PAYMENT_TIMEOUT_MINUTES * 60, STRIPE_MIN_CHECKOUT_EXPIRY_SECONDS) +
      CHECKOUT_EXPIRY_SAFETY_MARGIN_SECONDS,
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout-session:${input.orderId}`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a hosted checkout URL.");
  }

  const admin = createSupabaseAdminClient();
  const { error: insertError } = await admin.from("payments").insert({
    tenant_id: input.tenantId,
    order_id: input.orderId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    stripe_account_id: stripeAccountId,
    amount_cents: order.totalCents,
    currency: order.currency,
  });

  // A unique-violation here means Stripe answered an idempotent retry with
  // the identical session id we already recorded -- expected, not an error;
  // any other insert error (e.g. the DB-level ensure_payment_matches_order()
  // guard rejecting a mismatch) must surface, since it means something is
  // wrong with the payment we just asked Stripe to create.
  if (insertError && insertError.code !== "23505") {
    throw new Error("Failed to record the payment session.");
  }

  await recordOrderAuditEvent(admin, {
    tenantId: input.tenantId,
    action: "payment_started",
    targetType: "order",
    targetId: input.orderId,
    metadata: { stripeCheckoutSessionId: session.id },
  });

  return { checkoutUrl: session.url };
}

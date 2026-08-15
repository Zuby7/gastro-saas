import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { recordOrderAuditEvent } from "@/lib/audit/record-order-audit-event";

/**
 * Payment webhook processing (ticket #25, risk:payment) -- the ONLY code
 * path that is allowed to mark an order "paid"
 * (`.claude/rules/payments.md`).
 *
 * Split out of `apps/web/src/app/api/webhooks/stripe/route.ts` (which only
 * does signature verification + dedup, mirroring
 * `apps/web/src/app/api/webhooks/stripe-connect/route.ts`'s shape) so the
 * actual event-type handling logic can be unit tested directly against a
 * fake Supabase client, without constructing `NextRequest`s or mocking
 * Stripe signature verification for every scenario.
 *
 * Every code path below is careful to never throw for a *business* outcome
 * (amount mismatch, tenant mismatch, stale/out-of-order event, unknown
 * payment) -- `.claude/rules/payments.md`'s "do not resolve a mismatch by
 * trusting the webhook amount ... flag for manual review" and this ticket's
 * explicit "acknowledge the webhook (2xx) after flagging, since retrying
 * won't fix a genuine mismatch" guidance. Only a genuinely unexpected error
 * (e.g. the database being unreachable) propagates, so the caller route can
 * return a 5xx and let Stripe legitimately retry.
 */

interface OrderRecord {
  id: string;
  tenantId: string;
  status: string;
  totalCents: number;
  currency: string;
}

interface PaymentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  status: string;
}

async function fetchOrder(admin: SupabaseClient, orderId: string): Promise<OrderRecord | null> {
  const { data, error } = await admin
    .from("orders")
    .select("id, tenant_id, status, total_cents, currency")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      tenant_id: string;
      status: string;
      total_cents: number;
      currency: string;
    }>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    tenantId: data.tenant_id,
    status: data.status,
    totalCents: data.total_cents,
    currency: data.currency,
  };
}

function mapPaymentRow(data: {
  id: string;
  tenant_id: string;
  order_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_account_id: string;
  amount_cents: number;
  currency: string;
  status: string;
}): PaymentRecord {
  return {
    id: data.id,
    tenantId: data.tenant_id,
    orderId: data.order_id,
    stripeCheckoutSessionId: data.stripe_checkout_session_id,
    stripePaymentIntentId: data.stripe_payment_intent_id,
    stripeAccountId: data.stripe_account_id,
    amountCents: data.amount_cents,
    currency: data.currency,
    status: data.status,
  };
}

async function fetchPaymentByCheckoutSessionId(
  admin: SupabaseClient,
  stripeCheckoutSessionId: string,
): Promise<PaymentRecord | null> {
  const { data, error } = await admin
    .from("payments")
    .select(
      "id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status",
    )
    .eq("stripe_checkout_session_id", stripeCheckoutSessionId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapPaymentRow(data);
}

async function fetchPaymentByPaymentIntentId(
  admin: SupabaseClient,
  stripePaymentIntentId: string,
): Promise<PaymentRecord | null> {
  const { data, error } = await admin
    .from("payments")
    .select(
      "id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status",
    )
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapPaymentRow(data);
}

async function fetchTenantStripeAccountId(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("payment_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ stripe_account_id: string }>();

  return data?.stripe_account_id ?? null;
}

/**
 * Cross-checks tenant identity from at least two independent sources rather
 * than trusting any single one (`.claude/rules/payments.md`/ADR-0002: "never
 * assume a 1:1 platform-account-to-tenant mapping ... do not guess which
 * value is right"):
 *
 * - The `payments` row itself (our own record, written only once the
 *   tenant's Connect account was verified charge-ready at session-creation
 *   time by `ensure_payment_matches_order()`).
 * - The tenant's *current* `payment_accounts.stripe_account_id` (in case the
 *   account was rotated since the payment was created).
 * - The raw event's own connected-account reference (`event.account`), when
 *   Stripe populates it.
 * - The Checkout Session's `metadata.tenant_id`/`metadata.order_id`
 *   (attached by our own server at session-creation time, ticket #24).
 *
 * Returns `false` (and the caller must flag + refuse to process) if any
 * present source disagrees with the `payments` row.
 */
function tenantIdentityIsConsistent(params: {
  payment: PaymentRecord;
  tenantStripeAccountId: string | null;
  eventAccount: string | null | undefined;
  metadataTenantId: string | null | undefined;
  metadataOrderId: string | null | undefined;
}): boolean {
  const { payment, tenantStripeAccountId, eventAccount, metadataTenantId, metadataOrderId } =
    params;

  if (tenantStripeAccountId !== null && tenantStripeAccountId !== payment.stripeAccountId) {
    return false;
  }

  if (eventAccount != null && eventAccount !== payment.stripeAccountId) {
    return false;
  }

  if (metadataTenantId != null && metadataTenantId !== payment.tenantId) {
    return false;
  }

  if (metadataOrderId != null && metadataOrderId !== payment.orderId) {
    return false;
  }

  return true;
}

async function flagPaymentForReview(
  admin: SupabaseClient,
  payment: PaymentRecord,
  action: "payment_amount_mismatch_flagged" | "payment_webhook_tenant_mismatch_flagged",
  metadata: Record<string, unknown>,
): Promise<void> {
  await admin.from("payments").update({ status: "flagged_for_review" }).eq("id", payment.id);

  await recordOrderAuditEvent(admin, {
    tenantId: payment.tenantId,
    action,
    targetType: "order",
    targetId: payment.orderId,
    metadata,
  });
}

async function markOrderReceived(
  admin: SupabaseClient,
  params: {
    order: OrderRecord;
    payment: PaymentRecord;
    stripeEventId: string;
    stripePaymentIntentId: string | null;
  },
): Promise<void> {
  const { order, payment, stripeEventId, stripePaymentIntentId } = params;

  const { error: eventError } = await admin.from("order_status_events").insert({
    tenant_id: order.tenantId,
    order_id: order.id,
    from_status: "awaiting_payment",
    to_status: "received",
  });

  if (eventError) {
    // The state-machine/from-status guard (validate_order_status_event(),
    // ticket #21) is the actual authoritative enforcement point -- if this
    // rejects (e.g. a race where the order moved on between our read and
    // this insert), never fall back to trusting the webhook: log and
    // acknowledge without marking the payment paid.
    console.error(
      "[payments-webhook] failed to record order_status_events for order",
      order.id,
      eventError,
    );
    return;
  }

  await admin
    .from("payments")
    .update({
      status: "paid",
      stripe_payment_intent_id: stripePaymentIntentId ?? payment.stripePaymentIntentId,
    })
    .eq("id", payment.id);

  await recordOrderAuditEvent(admin, {
    tenantId: order.tenantId,
    action: "payment_confirmed",
    targetType: "order",
    targetId: order.id,
    metadata: { stripeEventId, stripeCheckoutSessionId: payment.stripeCheckoutSessionId },
  });
}

async function markOrderCancelledForPaymentFailure(
  admin: SupabaseClient,
  params: {
    order: OrderRecord;
    payment: PaymentRecord;
    stripeEventId: string;
    reason: "payment_failed" | "checkout_session_expired";
  },
): Promise<void> {
  const { order, payment, stripeEventId, reason } = params;

  const { error: eventError } = await admin.from("order_status_events").insert({
    tenant_id: order.tenantId,
    order_id: order.id,
    from_status: "awaiting_payment",
    to_status: "cancelled",
  });

  if (eventError) {
    console.error(
      "[payments-webhook] failed to record cancellation order_status_events for order",
      order.id,
      eventError,
    );
    return;
  }

  await admin
    .from("payments")
    .update({ status: reason === "checkout_session_expired" ? "cancelled" : "failed" })
    .eq("id", payment.id);

  await recordOrderAuditEvent(admin, {
    tenantId: order.tenantId,
    action: reason === "checkout_session_expired" ? "payment_session_expired" : "payment_failed",
    targetType: "order",
    targetId: order.id,
    metadata: { stripeEventId },
  });
}

async function handleCheckoutSessionCompleted(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  const payment = await fetchPaymentByCheckoutSessionId(admin, session.id);
  if (!payment) {
    console.error("[payments-webhook] no payments row found for checkout session", session.id);
    return;
  }

  const order = await fetchOrder(admin, payment.orderId);
  if (!order || order.tenantId !== payment.tenantId) {
    console.error("[payments-webhook] order not found or tenant mismatch for payment", payment.id);
    return;
  }

  const tenantStripeAccountId = await fetchTenantStripeAccountId(admin, payment.tenantId);
  const metadataTenantId =
    typeof session.metadata?.tenant_id === "string" ? session.metadata.tenant_id : null;
  const metadataOrderId =
    typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null;

  if (
    !tenantIdentityIsConsistent({
      payment,
      tenantStripeAccountId,
      eventAccount: event.account ?? null,
      metadataTenantId,
      metadataOrderId,
    })
  ) {
    await flagPaymentForReview(admin, payment, "payment_webhook_tenant_mismatch_flagged", {
      stripeEventId: event.id,
      stripeCheckoutSessionId: session.id,
    });
    return;
  }

  if (order.status !== "awaiting_payment") {
    // Stale/out-of-order delivery: the order already moved on (paid by an
    // earlier delivery of this same event, or already cancelled/expired).
    // Never re-derive state from a delayed event -- the state machine has
    // already spoken.
    console.warn(
      "[payments-webhook] ignoring checkout.session.completed for order not in awaiting_payment",
      order.id,
      order.status,
    );
    return;
  }

  if (session.payment_status !== "paid") {
    // Async payment method still pending confirmation -- a later
    // checkout.session.async_payment_succeeded/failed event (out of this
    // ticket's explicit event set) would resolve it; nothing to do yet.
    return;
  }

  const eventAmountCents = session.amount_total;
  const eventCurrency = session.currency?.toUpperCase() ?? null;

  if (eventAmountCents !== order.totalCents || eventCurrency !== order.currency) {
    await flagPaymentForReview(admin, payment, "payment_amount_mismatch_flagged", {
      stripeEventId: event.id,
      stripeCheckoutSessionId: session.id,
      eventAmountCents,
      eventCurrency,
      orderTotalCents: order.totalCents,
      orderCurrency: order.currency,
    });
    return;
  }

  await markOrderReceived(admin, {
    order,
    payment,
    stripeEventId: event.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
  });
}

async function handleCheckoutSessionExpired(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  const payment = await fetchPaymentByCheckoutSessionId(admin, session.id);
  if (!payment) {
    console.error("[payments-webhook] no payments row found for expired session", session.id);
    return;
  }

  const order = await fetchOrder(admin, payment.orderId);
  if (!order || order.tenantId !== payment.tenantId) {
    console.error("[payments-webhook] order not found or tenant mismatch for payment", payment.id);
    return;
  }

  const tenantStripeAccountId = await fetchTenantStripeAccountId(admin, payment.tenantId);
  const metadataTenantId =
    typeof session.metadata?.tenant_id === "string" ? session.metadata.tenant_id : null;
  const metadataOrderId =
    typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null;

  if (
    !tenantIdentityIsConsistent({
      payment,
      tenantStripeAccountId,
      eventAccount: event.account ?? null,
      metadataTenantId,
      metadataOrderId,
    })
  ) {
    await flagPaymentForReview(admin, payment, "payment_webhook_tenant_mismatch_flagged", {
      stripeEventId: event.id,
      stripeCheckoutSessionId: session.id,
    });
    return;
  }

  if (order.status !== "awaiting_payment") {
    // A session can only expire before it was ever paid -- if the order has
    // already moved on (e.g. an earlier session for the same order already
    // succeeded, or it was already cancelled), this expiry is stale.
    return;
  }

  await markOrderCancelledForPaymentFailure(admin, {
    order,
    payment,
    stripeEventId: event.id,
    reason: "checkout_session_expired",
  });
}

async function handlePaymentIntentPaymentFailed(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  const payment = await fetchPaymentByPaymentIntentId(admin, paymentIntent.id);
  if (!payment) {
    console.error("[payments-webhook] no payments row found for payment intent", paymentIntent.id);
    return;
  }

  const order = await fetchOrder(admin, payment.orderId);
  if (!order || order.tenantId !== payment.tenantId) {
    console.error("[payments-webhook] order not found or tenant mismatch for payment", payment.id);
    return;
  }

  const tenantStripeAccountId = await fetchTenantStripeAccountId(admin, payment.tenantId);

  if (
    !tenantIdentityIsConsistent({
      payment,
      tenantStripeAccountId,
      eventAccount: event.account ?? null,
      metadataTenantId: null,
      metadataOrderId: null,
    })
  ) {
    await flagPaymentForReview(admin, payment, "payment_webhook_tenant_mismatch_flagged", {
      stripeEventId: event.id,
      stripePaymentIntentId: paymentIntent.id,
    });
    return;
  }

  if (order.status !== "awaiting_payment") {
    return;
  }

  await markOrderCancelledForPaymentFailure(admin, {
    order,
    payment,
    stripeEventId: event.id,
    reason: "payment_failed",
  });
}

/**
 * Processes one already signature-verified, not-yet-deduplicated-by-caller
 * Stripe payment event. The caller (`route.ts`) is responsible for
 * signature verification and the `payment_webhook_events` dedup insert --
 * this function is only ever invoked once per genuinely new event ID.
 */
export async function handleStripePaymentWebhookEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(admin, event);
      return;
    case "checkout.session.expired":
      await handleCheckoutSessionExpired(admin, event);
      return;
    case "payment_intent.payment_failed":
      await handlePaymentIntentPaymentFailed(admin, event);
      return;
    default:
      // Unhandled event types are acknowledged (route returns 200) but
      // otherwise ignored -- Stripe's webhook endpoint configuration should
      // only forward the event types this handler understands, but a
      // future dashboard misconfiguration must never crash the endpoint.
      return;
  }
}

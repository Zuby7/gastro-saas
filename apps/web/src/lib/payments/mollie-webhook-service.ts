import type { SupabaseClient } from "@supabase/supabase-js";
import { getMolliePayment, isMollieTestMode, type MolliePayment } from "@/lib/mollie/client";
import { MollieNotConnectedError, getMollieAccessForTenant } from "@/lib/mollie/tokens";
import {
  fetchOrder,
  flagPaymentForReview,
  markOrderCancelledForPaymentFailure,
  markOrderReceived,
  type PaymentRecord,
} from "./webhook-service";

/**
 * Mollie payment webhook processing (issue #195, ADR-0004) -- the Mollie
 * counterpart of the Stripe webhook rule in `.claude/rules/payments.md`.
 *
 * Mollie's webhook carries ONLY `id=<paymentId>` and no signature, so the
 * request itself proves nothing. The trust anchor is that this server fetches
 * the payment from Mollie with the owning restaurant's own OAuth token and
 * only acts on what Mollie answers. An attacker who POSTs a guessed or
 * replayed id can at worst trigger one more verified fetch.
 *
 * Verification before an order may become paid: our own `payments` row exists
 * for that Mollie id (unknown ids are ignored silently), Mollie reports status
 * `paid`, amount and currency equal the order's own server-calculated total
 * (never the webhook/Mollie value trusted over ours), `metadata.orderId`/
 * `metadata.tenantId` equal our row, the payment's profile matches the tenant's
 * connected profile, the method is PayPal, and a live payment is only accepted
 * when live mode is explicitly allowed. Any mismatch leaves the order unpaid and
 * flags the payment for manual review.
 *
 * Idempotency: only a `pending` payment of an `awaiting_payment` order can
 * transition, through the same atomic RPC as Stripe
 * (`mark_order_received_and_paid`) -- a replayed webhook finds the payment
 * already `paid` (or the order already moved on) and changes nothing.
 *
 * Business outcomes never throw (Mollie would retry forever); only a genuinely
 * unexpected failure (DB down, Mollie unreachable) propagates so the route
 * answers 5xx and Mollie retries.
 */

export const MOLLIE_PAYMENT_ID_PATTERN = /^tr_[A-Za-z0-9]{1,64}$/;

async function fetchMolliePaymentRecord(
  admin: SupabaseClient,
  molliePaymentId: string,
): Promise<(PaymentRecord & { mollieProvider: boolean }) | null> {
  const { data, error } = await admin
    .from("payments")
    .select("id, tenant_id, order_id, amount_cents, currency, status, provider")
    .eq("mollie_payment_id", molliePaymentId)
    .eq("provider", "mollie")
    .maybeSingle<{
      id: string;
      tenant_id: string;
      order_id: string;
      amount_cents: number;
      currency: string;
      status: string;
      provider: string;
    }>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    tenantId: data.tenant_id,
    orderId: data.order_id,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeAccountId: null,
    amountCents: data.amount_cents,
    currency: data.currency,
    status: data.status,
    mollieProvider: true,
  };
}

function identityIsConsistent(
  payment: PaymentRecord,
  mollie: MolliePayment,
  molliePaymentId: string,
  tenantProfileId: string | null,
): boolean {
  if (mollie.id !== molliePaymentId) return false;
  if (mollie.metadata.orderId !== payment.orderId) return false;
  if (mollie.metadata.tenantId !== payment.tenantId) return false;
  if (mollie.profileId && tenantProfileId && mollie.profileId !== tenantProfileId) return false;
  return true;
}

export async function handleMolliePaymentWebhook(
  admin: SupabaseClient,
  molliePaymentId: string,
): Promise<void> {
  const payment = await fetchMolliePaymentRecord(admin, molliePaymentId);
  if (!payment) {
    // Unknown id: nothing to do and nothing to reveal.
    return;
  }

  if (payment.status !== "pending") {
    // Already processed (paid/failed/cancelled/flagged): replay is a no-op.
    return;
  }

  const order = await fetchOrder(admin, payment.orderId);
  if (!order || order.tenantId !== payment.tenantId) {
    console.error("[mollie-webhook] order not found or tenant mismatch for payment", payment.id);
    return;
  }

  const auditBase = { provider: "mollie", molliePaymentId };

  let access;
  try {
    access = await getMollieAccessForTenant(admin, payment.tenantId);
  } catch (error) {
    if (error instanceof MollieNotConnectedError) {
      // The restaurant disconnected (or needs to reconnect) so we cannot
      // verify the payment: never guess -- flag for manual review.
      await flagPaymentForReview(admin, payment, "payment_webhook_tenant_mismatch_flagged", {
        ...auditBase,
        reason: "mollie_not_connected",
      });
      return;
    }
    throw error;
  }

  // Throws on transport/5xx/4xx -> route answers 5xx, Mollie retries.
  const mollie = await getMolliePayment(access.accessToken, molliePaymentId);

  if (!identityIsConsistent(payment, mollie, molliePaymentId, access.profileId)) {
    await flagPaymentForReview(admin, payment, "payment_webhook_tenant_mismatch_flagged", {
      ...auditBase,
      reason: "identity_mismatch",
    });
    return;
  }

  if (mollie.status === "paid") {
    if (order.status !== "awaiting_payment") {
      if (order.status === "cancelled") {
        await flagPaymentForReview(admin, payment, "payment_after_order_cancelled_flagged", {
          ...auditBase,
          orderStatus: order.status,
        });
      }
      return;
    }

    // A live payment while live mode is not allowed, or a non-PayPal method,
    // is never silently accepted.
    if (
      (mollie.mode === "live" && isMollieTestMode()) ||
      (mollie.method !== null && mollie.method !== "paypal")
    ) {
      await flagPaymentForReview(admin, payment, "payment_amount_mismatch_flagged", {
        ...auditBase,
        reason: "mode_or_method_mismatch",
        mode: mollie.mode,
        method: mollie.method,
      });
      return;
    }

    if (mollie.amountCents !== order.totalCents || mollie.currency !== order.currency) {
      await flagPaymentForReview(admin, payment, "payment_amount_mismatch_flagged", {
        ...auditBase,
        eventAmountCents: mollie.amountCents,
        eventCurrency: mollie.currency,
        orderTotalCents: order.totalCents,
        orderCurrency: order.currency,
      });
      return;
    }

    await markOrderReceived(admin, {
      order,
      payment,
      stripeEventId: `mollie:${molliePaymentId}`,
      stripePaymentIntentId: null,
      // Mollie does not report the payer's e-mail for PayPal payments.
      customerEmail: null,
      auditMetadata: auditBase,
    });
    return;
  }

  if (mollie.status === "failed" || mollie.status === "canceled" || mollie.status === "expired") {
    if (order.status !== "awaiting_payment") {
      return;
    }
    await markOrderCancelledForPaymentFailure(admin, {
      order,
      payment,
      stripeEventId: `mollie:${molliePaymentId}`,
      reason: mollie.status === "expired" ? "checkout_session_expired" : "payment_failed",
      auditMetadata: { ...auditBase, mollieStatus: mollie.status },
    });
    return;
  }

  // open / pending / authorized: nothing to do yet; Mollie calls again.
}

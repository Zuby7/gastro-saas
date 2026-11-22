import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordOrderAuditEvent } from "@/lib/audit/record-order-audit-event";
import { createMolliePayment } from "@/lib/mollie/client";
import { MollieNotConnectedError, getMollieAccessForTenant } from "@/lib/mollie/tokens";
import { fetchOrderPaymentSnapshot } from "./service";
import {
  PaymentAccountNotReadyError,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
} from "./types";

/**
 * Creates a Mollie payment (PayPal) for an order that is `awaiting_payment`
 * (issue #195, ADR-0004) and records the `payments` row (provider 'mollie').
 *
 * - The amount is ALWAYS the order's own immutable, server-calculated total
 *   re-read from the database here -- never a client-supplied value. The
 *   `ensure_payment_matches_order()` DB trigger re-verifies it on INSERT.
 * - The restaurant is the Mollie merchant: the payment is created with the
 *   restaurant's own OAuth token; the platform holds no funds.
 * - Never marks anything paid. Only the verified Mollie webhook
 *   (`mollie-webhook-service.ts`) does that.
 * - Retries are idempotent via Mollie's `Idempotency-Key` plus the unique
 *   `payments.mollie_payment_id`.
 */
export async function createMolliePaymentForOrder(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const order = await fetchOrderPaymentSnapshot(input.tenantId, input.orderId);

  if (order.status !== "awaiting_payment") {
    throw new Error("This order is not awaiting payment.");
  }
  if (order.currency !== "EUR") {
    throw new Error("Mollie payments are only supported in EUR.");
  }

  const admin = createSupabaseAdminClient();

  let access;
  try {
    access = await getMollieAccessForTenant(admin, input.tenantId);
  } catch (error) {
    if (error instanceof MollieNotConnectedError) {
      throw new PaymentAccountNotReadyError(
        "PayPal ist für dieses Restaurant derzeit nicht verfügbar.",
      );
    }
    throw error;
  }
  if (!access.profileId) {
    throw new PaymentAccountNotReadyError(
      "PayPal ist für dieses Restaurant derzeit nicht verfügbar.",
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const orderStatusUrl = `${origin}/r/${input.tenantSlug}/orders/${input.guestAccessToken}`;

  const payment = await createMolliePayment(access.accessToken, access.profileId, {
    amountCents: order.totalCents,
    description: `Bestellung ${order.orderId.slice(0, 8).toUpperCase()}`,
    // Returning here is never proof of payment -- the status page only
    // reflects the webhook-verified order status.
    redirectUrl: `${orderStatusUrl}?checkout=success`,
    webhookUrl: `${origin}/api/webhooks/mollie`,
    orderId: order.orderId,
    tenantId: input.tenantId,
    idempotencyKey: `mollie-payment:${input.orderId}`,
  });

  if (!payment.checkoutUrl) {
    throw new Error("Mollie did not return a hosted checkout URL.");
  }

  const { error: insertError } = await admin.from("payments").insert({
    tenant_id: input.tenantId,
    order_id: input.orderId,
    provider: "mollie",
    mollie_payment_id: payment.id,
    amount_cents: order.totalCents,
    currency: order.currency,
  });

  // 23505: an idempotent retry returned the payment we already recorded.
  if (insertError && insertError.code !== "23505") {
    throw new Error("Failed to record the payment.");
  }

  await recordOrderAuditEvent(admin, {
    tenantId: input.tenantId,
    action: "payment_started",
    targetType: "order",
    targetId: input.orderId,
    metadata: { provider: "mollie", molliePaymentId: payment.id },
  });

  return { checkoutUrl: payment.checkoutUrl };
}

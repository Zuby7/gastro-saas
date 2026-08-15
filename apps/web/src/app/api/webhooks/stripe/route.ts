import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStripeClient, getStripePaymentsWebhookSecret } from "@/lib/stripe/client";
import { handleStripePaymentWebhookEvent } from "@/lib/payments/webhook-service";

/**
 * Stripe **payment events** webhook endpoint (ticket #25) -- the only code
 * path allowed to transition an order to "paid"
 * (`.claude/rules/payments.md`). Receives `checkout.session.completed`,
 * `checkout.session.expired`, and `payment_intent.payment_failed` events on
 * the *platform* account (ADR-0002 destination charges).
 *
 * Deliberately a separate endpoint/signing secret from ticket #23's
 * `/api/webhooks/stripe-connect` (`account.updated` events) -- see that
 * route's header comment. Both share the same verify -> dedup -> process
 * shape and the same `payment_webhook_events` dedup table (ticket #23's
 * migration), reused here rather than duplicated.
 *
 * This route only does signature verification + dedup; all event-type
 * handling lives in `apps/web/src/lib/payments/webhook-service.ts` so it can
 * be unit tested directly.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new NextResponse("Missing signature", { status: 400 });
  }

  // Signature verification requires the exact, untouched raw request body
  // bytes Stripe signed -- `request.text()` reads the body without any
  // Next.js JSON parsing/re-serialization that could otherwise produce a
  // byte-for-byte different string and spuriously fail verification (or,
  // worse, be skipped). Mirrors `stripe-connect/route.ts`'s solution to the
  // same problem.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = createStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, getStripePaymentsWebhookSecret());
  } catch {
    // Never leak signature/verification internals to the caller.
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Idempotent dedup by Stripe event ID, inserted BEFORE any processing --
  // a unique-violation means this exact event was already received (Stripe
  // retries webhooks on non-2xx) -- acknowledge and stop without
  // reprocessing, never double-transition an order or double-write an
  // audit entry from a replayed delivery.
  const { error: insertError } = await admin.from("payment_webhook_events").insert({
    stripe_event_id: event.id,
    stripe_account_id: event.account ?? null,
    event_type: event.type,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return new NextResponse("Failed to record webhook event", { status: 500 });
  }

  try {
    await handleStripePaymentWebhookEvent(admin, event);
  } catch (error) {
    // A genuinely unexpected error (e.g. the database being unreachable) --
    // log for investigation and let Stripe retry. Business-outcome cases
    // (amount mismatch, tenant mismatch, stale/out-of-order event, unknown
    // payment) are handled inside handleStripePaymentWebhookEvent() without
    // throwing, per .claude/rules/payments.md ("do not guess which value is
    // right ... flag for manual review").
    console.error("[payments-webhook] unexpected error processing event", event.id, error);
    return new NextResponse("Failed to process webhook event", { status: 500 });
  }

  await admin
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", event.id);

  return NextResponse.json({ received: true });
}

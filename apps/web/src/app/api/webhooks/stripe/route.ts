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
 * route's header comment. Both share the same verify -> claim -> process ->
 * mark-processed shape and the same `payment_webhook_events` dedup table
 * (ticket #23's migration) via `claim_payment_webhook_event()` (epic-7 batch
 * review fix -- see that function's comment for why the dedup claim must be
 * reclaimable rather than a one-way insert-is-the-receipt).
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

  // Dedup/claim by Stripe event ID via `claim_payment_webhook_event()`
  // (epic-7 batch review fix, mirroring the identical fix already applied to
  // `stripe-connect/route.ts`): a plain unique-violation on insert used to
  // mean "already received, never reprocess" -- but that made a row that was
  // claimed and then never reached `processed_at` (an unexpected error
  // during processing below) permanently unreclaimable by Stripe's own
  // retry of the very same event id. The RPC only reports
  // `already_processed: true` once a row has genuinely completed
  // processing; a retry of a claimed-but-incomplete row is reported as not
  // yet processed and is (re)processed below.
  const { data: claimRows, error: claimError } = await admin.rpc("claim_payment_webhook_event", {
    p_stripe_event_id: event.id,
    p_stripe_account_id: event.account ?? null,
    p_event_type: event.type,
  });

  if (claimError) {
    return new NextResponse("Failed to record webhook event", { status: 500 });
  }

  const alreadyProcessed = Boolean(
    (claimRows as { already_processed: boolean }[] | null)?.[0]?.already_processed,
  );
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleStripePaymentWebhookEvent(admin, event);
  } catch (error) {
    // A genuinely unexpected error (e.g. the database being unreachable) --
    // log for investigation and let Stripe retry. Deliberately leave
    // `processed_at` null: this event id remains reclaimable so Stripe's
    // retry can genuinely reprocess it (see the claim RPC above) instead of
    // being permanently swallowed as a "duplicate". Business-outcome cases
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

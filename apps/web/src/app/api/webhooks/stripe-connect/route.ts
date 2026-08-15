import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStripeClient, getStripeConnectWebhookSecret } from "@/lib/stripe/client";
import { summarizeAccount } from "@/lib/stripe/connect";

/**
 * Stripe **Connect** webhook endpoint (ticket #23) -- receives
 * `account.updated` events so onboarding status stays in sync in the
 * background even if the tenant owner never returns to `/account/payments`.
 *
 * This is deliberately a separate endpoint/signing secret from ticket #25's
 * eventual platform-account payment webhook
 * (`/api/webhooks/stripe`, per ADR-0002 "webhooks for payment events arrive
 * on the platform account") -- Stripe requires Connect events and
 * account-level events to be configured as distinct webhook endpoints. Both
 * endpoints share the same verify -> dedup -> process shape and the same
 * `payment_webhook_events` dedup table; ticket #25 should reuse that table
 * rather than adding a second one.
 *
 * `.claude/rules/payments.md` webhook rule: signature-verified,
 * idempotent, deduped by event ID -- enforced below before any write.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new NextResponse("Missing signature", { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = createStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, getStripeConnectWebhookSecret());
  } catch {
    // Never leak signature/verification internals to the caller.
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Dedup/claim by Stripe event ID via `claim_payment_webhook_event()`
  // (epic-7 batch review fix): a plain unique-violation on insert used to
  // mean "already received, never reprocess" -- but that made a row that
  // was claimed and then never reached `processed_at` (an unexpected error
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
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const snapshot = summarizeAccount(account);

      // `apply_connect_account_snapshot()` guards against a delayed/
      // out-of-order older `account.updated` event clobbering newer,
      // already-applied status (epic-7 batch review fix) -- it only applies
      // this snapshot when `event.created` is not older than the last event
      // timestamp already stored for this account.
      const { error: applyError } = await admin.rpc("apply_connect_account_snapshot", {
        p_stripe_account_id: account.id,
        p_event_at: new Date(event.created * 1000).toISOString(),
        p_status: snapshot.status,
        p_charges_enabled: snapshot.chargesEnabled,
        p_payouts_enabled: snapshot.payoutsEnabled,
        p_requirements_summary: snapshot.requirementsSummary,
      });
      // supabase-js reports DB errors via the returned `error` field rather
      // than throwing -- re-throw explicitly so this falls through to the
      // catch below and leaves the event reclaimable, same as any other
      // unexpected processing failure.
      if (applyError) {
        throw new Error(applyError.message);
      }
    }
  } catch (error) {
    // Deliberately leave `processed_at` null: this event id remains
    // reclaimable so Stripe's retry can genuinely reprocess it (see the
    // claim RPC above) instead of being permanently swallowed as a
    // "duplicate". Stripe legitimately retries on a 500.
    console.error("[stripe-connect webhook] processing failed, leaving event reclaimable", error);
    return new NextResponse("Processing failed", { status: 500 });
  }

  await admin
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", event.id);

  return NextResponse.json({ received: true });
}

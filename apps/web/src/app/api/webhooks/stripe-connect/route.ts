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

  // Dedup by Stripe event ID: a unique-violation on insert means this event
  // was already received (Stripe retries webhooks) -- acknowledge and stop
  // without reprocessing, never re-derive state from a duplicate delivery.
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

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const snapshot = summarizeAccount(account);

    await admin
      .from("payment_accounts")
      .update({
        status: snapshot.status,
        charges_enabled: snapshot.chargesEnabled,
        payouts_enabled: snapshot.payoutsEnabled,
        requirements_summary: snapshot.requirementsSummary,
        onboarding_completed_at: snapshot.status === "enabled" ? new Date().toISOString() : null,
      })
      .eq("stripe_account_id", account.id);
  }

  await admin
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", event.id);

  return NextResponse.json({ received: true });
}

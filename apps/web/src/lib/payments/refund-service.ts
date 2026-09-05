import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";

/**
 * Refund issuing (ticket #26, risk:payment) -- `.claude/rules/payments.md`:
 * "Refunds require an explicit `payments.refund` permission, always go
 * through a server-side provider call, and always write an audit entry
 * (actor, amount, reason, provider reference, timestamp). A refund can
 * never exceed the paid amount."
 *
 * Two enforcement layers for `payments.refund`, matching this repo's
 * established tenant-isolation/RBAC standard:
 *   1. The caller (`apps/web/src/app/account/orders/[orderId]/actions.ts`)
 *      must already have called `requireTenantPermission(..., 'payments.refund')`
 *      before invoking this module -- this module does not re-derive the
 *      caller's session itself, it works entirely through the
 *      already-authenticated, RLS-scoped `supabase` client passed in.
 *   2. `refunds_insert_payments_refund`/`refunds_update_payments_refund`
 *      (see the refunds migration) independently re-check the same
 *      permission at the RLS layer -- a bug or bypass in (1) can never let
 *      an unauthorized session write a refund row.
 *
 * Never-exceed-paid-amount: this module never trusts a client-displayed
 * "remaining refundable amount" -- it always re-derives the payment's
 * current state from the database immediately before acting, and the
 * actual, race-proof enforcement is the DB-level
 * `ensure_refund_matches_payment_and_within_limit()` trigger (locks the
 * `payments` row for the duration of the INSERT, see the refunds
 * migration), not this application code. This module's own pre-check exists
 * only to produce a clear, translated error message before ever calling
 * Stripe -- the DB trigger is what actually closes the concurrent-request
 * race.
 *
 * Destination-charge refund (ADR-0002): the original charge was created on
 * the *platform* account with `on_behalf_of` + `transfer_data.destination`
 * pointing at the tenant's connected account, so the refund is likewise
 * issued on the platform account (no `Stripe-Account` header/`stripeAccount`
 * option) against the payment intent/charge -- but with `reverse_transfer:
 * true`, which claws back the corresponding amount of the funds Stripe
 * already transferred to the connected account. Without `reverse_transfer`,
 * a refund on a destination charge only reduces the platform account's own
 * balance while leaving the connected account's transferred funds
 * untouched, silently leaving the platform short -- this is the
 * Connect-specific detail this ticket calls out explicitly.
 *
 * Reason mapping: Stripe's own `reason` enum (`duplicate` | `fraudulent` |
 * `requested_by_customer`) is far too restrictive to represent a manager's
 * free-text explanation, so it is not force-fit -- this module always sends
 * `requested_by_customer` (the closest generic fit for a manager-initiated
 * refund) and carries the real, richer reason in both `refunds.reason` (our
 * own table) and Stripe's own `metadata.reason` (best-effort, for anyone
 * looking at the Stripe dashboard directly).
 *
 * Definitive vs. ambiguous Stripe failures (Opus epic-7 batch review finding
 * 1): if `stripe.refunds.create()` throws, this module distinguishes two
 * cases via the Stripe Node SDK's own error classes
 * (`isDefinitiveStripeFailure()` below):
 *   - DEFINITIVE (`StripeCardError` / `StripeInvalidRequestError` /
 *     `StripeAuthenticationError` / `StripePermissionError` /
 *     `StripeIdempotencyError`): Stripe synchronously rejected the request
 *     before it moved any money -- we KNOW for certain the refund did not
 *     happen. These are marked `failed`, which (per the refunds migration)
 *     releases the reserved amount for a genuine retry.
 *   - AMBIGUOUS (anything else -- `StripeConnectionError`, `StripeAPIError`,
 *     a bare network/timeout error, or any other unrecognized throw): the
 *     response was lost before we could confirm one way or the other. Stripe
 *     may well have processed the refund; if we marked this `failed` (as a
 *     naive implementation once did), the reserved amount would be released
 *     and a retry would mint a brand-new `refunds` row with a brand-new
 *     idempotency key (`refund:<new-row-id>`) -- which Stripe cannot
 *     recognize as a retry of the earlier attempt, so a genuinely-succeeded
 *     first attempt plus a retried second attempt would refund the money
 *     TWICE at Stripe while the database only ever shows one `succeeded`
 *     row. To prevent this, an ambiguous failure is marked `unconfirmed`
 *     (see the refunds migration's status check-constraint) instead of
 *     `failed`. `unconfirmed` still counts against the payment's remaining
 *     refundable amount (same as `pending`/`succeeded`) AND (epic-7 batch
 *     review cycle-2 fix) the DB trigger
 *     (`ensure_refund_matches_payment_and_within_limit`) now outright
 *     rejects any further refunds INSERT for the same payment while an
 *     `unconfirmed` row exists, regardless of remaining amount headroom --
 *     this application layer mirrors that with its own pre-check
 *     (`RefundAwaitingReconciliationError`) purely for a clear, translated
 *     message before ever calling Stripe; the DB trigger is what actually
 *     closes the race. Earlier revisions of this comment claimed a careless
 *     retry "cannot double-reserve, let alone double-refund" on the strength
 *     of the amount check alone -- that was false for a second, smaller
 *     partial-refund attempt, which the amount check alone would not have
 *     blocked; this explicit existence check is what makes the guarantee
 *     hold.
 *     `unconfirmed` is a terminal, manual-reconciliation state: someone must
 *     check the real Stripe dashboard/API for what actually happened and
 *     resolve it by hand. Building automatic reconciliation via a
 *     `charge.refunded`/`refund.updated` webhook listener is a larger scope
 *     than this fix -- the existing payment webhook
 *     (`apps/web/src/app/api/webhooks/stripe/route.ts`, ticket #25) does not
 *     currently subscribe to any refund-related event types at all, so a
 *     dedicated refund-reconciliation webhook is a clean, scoped follow-up
 *     ticket, not built here. This is a documented residual risk: an
 *     `unconfirmed` refund is not auto-retryable and requires a human to
 *     reconcile it. See `docs/operations/refund-reconciliation.md` for the
 *     manual procedure.
 *
 * Request idempotency (issue #97, risk:payment): two rapid, identical
 * double-clicks of the same partial-refund submission previously each
 * individually passed the never-exceed-paid-amount check (as long as both
 * fit under the remaining headroom) and so created two independent refunds
 * for one intended user action -- only the client-side disabled button
 * guarded against this, which cannot close the race between two requests
 * both already in flight before the disabled state took effect. The caller
 * (`.../actions.ts`) now generates one client-side request token
 * (`crypto.randomUUID()`) per submission attempt and passes it through as
 * `requestToken`; this module writes it into `refunds.request_token`, which
 * is unique per `payment_id` (see the refunds-request-idempotency
 * migration) -- a repeat INSERT with the same token for the same payment is
 * rejected by the database (`DuplicateRefundRequestError`) before ever
 * calling Stripe.
 *
 * Finalization lockdown (issue #93, epic-7 cycle-3 fix): a refund row's
 * pending -> succeeded|failed|unconfirmed transition is no longer a plain
 * authenticated UPDATE -- `refunds` no longer grants `authenticated` UPDATE
 * at all. Finalization goes exclusively through the `finalize_refund()`
 * service_role SECURITY DEFINER RPC (see the migration), called here via
 * `createSupabaseAdminClient()`, never the caller's own RLS-scoped
 * `supabase` client. This closes the gap where a `payments.refund` holder
 * could finalize a row directly via PostgREST -- e.g. flipping a row that is
 * still `pending` only because ITS OWN finalize call was lost (issue #94) to
 * `failed`, releasing a reservation whose real Stripe outcome is still
 * unknown. `finalize_refund()` raises if the target row is missing or not
 * `pending` rather than silently no-op-ing, so a lost/duplicate finalize
 * attempt is always logged (issue #94), not swallowed.
 */

/**
 * Distinguishes a DEFINITIVE Stripe failure (Stripe synchronously rejected
 * the request -- the refund is known NOT to have happened at Stripe) from an
 * AMBIGUOUS one (the response was lost -- e.g. network timeout/connection
 * reset -- and Stripe may or may not have actually processed the refund).
 * See the module header for why this distinction matters.
 */
export function isDefinitiveStripeFailure(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeCardError ||
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeIdempotencyError ||
    // A 429 means Stripe synchronously rejected the request before doing
    // anything with it (definitive, like the other 4xx classes above) --
    // unlike a connection/timeout error, there is no ambiguity about
    // whether money moved (epic-7 batch review cycle-2 SHOULD-fix; this was
    // previously miscategorized as ambiguous alongside genuine
    // connection/timeout failures).
    error instanceof Stripe.errors.StripeRateLimitError
  );
}

export class PaymentNotRefundableError extends Error {
  constructor(message = "Für diese Bestellung liegt keine bezahlte Zahlung vor.") {
    super(message);
    this.name = "PaymentNotRefundableError";
  }
}

export class RefundExceedsRemainingAmountError extends Error {
  constructor(message = "Der Rückerstattungsbetrag übersteigt den bereits bezahlten Betrag.") {
    super(message);
    this.name = "RefundExceedsRemainingAmountError";
  }
}

export class RefundInvalidAmountError extends Error {
  constructor(message = "Der Rückerstattungsbetrag muss größer als 0 sein.") {
    super(message);
    this.name = "RefundInvalidAmountError";
  }
}

export class RefundAwaitingReconciliationError extends Error {
  constructor(
    message = "Für diese Zahlung liegt eine unbestätigte Rückerstattung vor, die zuerst manuell im Stripe-Dashboard geprüft werden muss. Erst danach kann eine weitere Rückerstattung ausgelöst werden.",
  ) {
    super(message);
    this.name = "RefundAwaitingReconciliationError";
  }
}

export class DuplicateRefundRequestError extends Error {
  constructor(
    message = "Diese Rückerstattung wurde bereits übermittelt. Bitte laden Sie die Seite neu, bevor Sie eine neue Rückerstattung auslösen.",
  ) {
    super(message);
    this.name = "DuplicateRefundRequestError";
  }
}

export class RefundInvalidRequestTokenError extends Error {
  constructor(
    message = "Ungültige Anfrage. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
  ) {
    super(message);
    this.name = "RefundInvalidRequestTokenError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PaymentRow {
  id: string;
  tenant_id: string;
  order_id: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
}

interface RefundRow {
  id: string;
  amount_cents: number;
  status: string;
}

export interface PaymentRefundSummary {
  paymentId: string;
  amountCents: number;
  currency: string;
  refundedOrReservedCents: number;
  remainingRefundableCents: number;
  refunds: Array<{
    id: string;
    amountCents: number;
    currency: string;
    reason: string;
    status: string;
    stripeRefundId: string | null;
    actorUserId: string;
    createdAt: string;
  }>;
}

/**
 * Reads the order's latest `paid` payment plus its full refund history,
 * through the caller's own RLS-scoped session client (`payments_select_payments_read`/
 * `refunds_select_payments_read`, both gated on `payments.read`). Returns
 * `null` if the order has no paid payment (nothing to refund).
 */
export async function getPaymentRefundSummary(
  supabase: SupabaseClient,
  params: { tenantId: string; orderId: string },
): Promise<PaymentRefundSummary | null> {
  const { data: payment } = await supabase
    .from("payments")
    .select("id, tenant_id, order_id, stripe_payment_intent_id, amount_cents, currency, status")
    .eq("tenant_id", params.tenantId)
    .eq("order_id", params.orderId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentRow>();

  if (!payment) {
    return null;
  }

  const { data: refunds } = await supabase
    .from("refunds")
    .select(
      "id, amount_cents, currency, reason, status, stripe_refund_id, actor_user_id, created_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("payment_id", payment.id)
    .order("created_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        amount_cents: number;
        currency: string;
        reason: string;
        status: string;
        stripe_refund_id: string | null;
        actor_user_id: string;
        created_at: string;
      }>
    >();

  const rows = refunds ?? [];
  const refundedOrReservedCents = rows
    .filter(
      (row) =>
        row.status === "pending" || row.status === "succeeded" || row.status === "unconfirmed",
    )
    .reduce((sum, row) => sum + row.amount_cents, 0);

  return {
    paymentId: payment.id,
    amountCents: payment.amount_cents,
    currency: payment.currency,
    refundedOrReservedCents,
    remainingRefundableCents: payment.amount_cents - refundedOrReservedCents,
    refunds: rows.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      currency: row.currency,
      reason: row.reason,
      status: row.status,
      stripeRefundId: row.stripe_refund_id,
      actorUserId: row.actor_user_id,
      createdAt: row.created_at,
    })),
  };
}

export interface IssueRefundInput {
  tenantId: string;
  orderId: string;
  actorUserId: string;
  amountCents: number;
  reason: string;
  /**
   * Client-generated (crypto.randomUUID()) idempotency token, one per
   * refund submission attempt (issue #97, risk:payment) -- see module
   * header. Required so a double-clicked submission cannot create two
   * independent refund rows.
   */
  requestToken: string;
}

export interface IssueRefundResult {
  refundId: string;
  stripeRefundId: string;
  amountCents: number;
}

/**
 * Issues a full or partial refund for an order's paid payment. Caller must
 * already have verified `payments.refund` before invoking this (see module
 * header). Steps:
 *
 *   1. Re-reads the order's paid payment fresh from the database (never a
 *      caller-supplied "remaining refundable amount").
 *   2. Inserts a `pending` `refunds` row -- the DB trigger
 *      (`ensure_refund_matches_payment_and_within_limit`) locks the payment
 *      row and atomically re-verifies the amount does not exceed what's
 *      still refundable, closing the race between concurrent requests.
 *   3. Calls `stripe.refunds.create()` against the payment intent, with
 *      `reverse_transfer: true` (see module header).
 *   4. Finalizes the `refunds` row to `succeeded` (with the Stripe refund
 *      id), `failed` (definitive Stripe rejection), or `unconfirmed`
 *      (ambiguous failure -- see module header), and always writes an audit
 *      entry with actor, amount, reason, provider reference, and timestamp
 *      (`audit_logs.created_at`) -- regardless of the Stripe outcome.
 */
export async function issueRefundForOrder(
  supabase: SupabaseClient,
  input: IssueRefundInput,
): Promise<IssueRefundResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RefundInvalidAmountError();
  }

  if (!UUID_RE.test(input.requestToken)) {
    throw new RefundInvalidRequestTokenError();
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("id, tenant_id, order_id, stripe_payment_intent_id, amount_cents, currency, status")
    .eq("tenant_id", input.tenantId)
    .eq("order_id", input.orderId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentRow>();

  if (!payment || !payment.stripe_payment_intent_id) {
    throw new PaymentNotRefundableError();
  }

  const { data: existingRefunds } = await supabase
    .from("refunds")
    .select("amount_cents, status")
    .eq("tenant_id", input.tenantId)
    .eq("payment_id", payment.id)
    .returns<RefundRow[]>();

  // Application-level pre-check: gives a clear, translated error before ever
  // calling Stripe. NOT the race-proof guarantee -- see module header; the
  // DB trigger below re-verifies this atomically regardless.
  if ((existingRefunds ?? []).some((row) => row.status === "unconfirmed")) {
    throw new RefundAwaitingReconciliationError();
  }

  const alreadyReservedCents = (existingRefunds ?? [])
    .filter(
      (row) =>
        row.status === "pending" || row.status === "succeeded" || row.status === "unconfirmed",
    )
    .reduce((sum, row) => sum + row.amount_cents, 0);

  if (alreadyReservedCents + input.amountCents > payment.amount_cents) {
    throw new RefundExceedsRemainingAmountError();
  }

  const { data: reservedRefund, error: insertError } = await supabase
    .from("refunds")
    .insert({
      tenant_id: input.tenantId,
      payment_id: payment.id,
      order_id: input.orderId,
      amount_cents: input.amountCents,
      currency: payment.currency,
      reason: input.reason,
      actor_user_id: input.actorUserId,
      request_token: input.requestToken,
      status: "pending",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !reservedRefund) {
    // The DB is the race-proof source of truth (see module header): a
    // concurrent request could have created the blocking unconfirmed row,
    // pushed the reserved total over the limit, or (issue #97) already
    // reserved the exact same request_token for this payment, between this
    // module's own pre-checks above and this INSERT. `hint` is how the
    // unconfirmed-reconciliation rejection is marked specifically (epic-7
    // cycle-2 fix); a unique-violation (23505) on `request_token` is a
    // double-submit of the same client-generated token (issue #97); anything
    // else mentioning "exceed" is the amount-limit rejection.
    if (insertError?.hint === "unconfirmed_refund_exists") {
      throw new RefundAwaitingReconciliationError();
    }
    if (insertError?.code === "23505") {
      throw new DuplicateRefundRequestError();
    }
    if ((insertError?.message ?? "").toLowerCase().includes("exceed")) {
      throw new RefundExceedsRemainingAmountError();
    }
    throw new Error("Die Rückerstattung konnte nicht angelegt werden.");
  }

  const stripe = createStripeClient();

  try {
    const stripeRefund = await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount: input.amountCents,
        reason: "requested_by_customer",
        // ADR-0002 destination charge: claw back the connected account's
        // transferred funds too, not just the platform account's balance.
        reverse_transfer: true,
        metadata: {
          refund_id: reservedRefund.id,
          reason: input.reason,
        },
      },
      { idempotencyKey: `refund:${reservedRefund.id}` },
    );

    const admin = createSupabaseAdminClient();
    const { error: finalizeError } = await admin.rpc("finalize_refund", {
      p_refund_id: reservedRefund.id,
      p_status: "succeeded",
      p_stripe_refund_id: stripeRefund.id,
    });

    if (finalizeError) {
      // The refund DID succeed at Stripe (we're past stripe.refunds.create()
      // without throwing) -- a failure here means our own row never recorded
      // that. Log loudly so this surfaces to monitoring (issue #94): the
      // fix is to manually set this row to 'succeeded' with the Stripe
      // refund id above, not to retry the Stripe call.
      console.error(
        "[refund-service] finalize_refund(succeeded) failed after a successful Stripe refund -- manual reconciliation required",
        { refundId: reservedRefund.id, stripeRefundId: stripeRefund.id, error: finalizeError },
      );
    }

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payment.refund_succeeded",
      targetType: "order",
      targetId: input.orderId,
      metadata: {
        refundId: reservedRefund.id,
        paymentId: payment.id,
        amountCents: input.amountCents,
        currency: payment.currency,
        reason: input.reason,
        stripeRefundId: stripeRefund.id,
      },
    });

    return {
      refundId: reservedRefund.id,
      stripeRefundId: stripeRefund.id,
      amountCents: input.amountCents,
    };
  } catch (error) {
    // See module header: a DEFINITIVE Stripe failure means the refund is
    // known NOT to have happened, so it's safe to release the reserved
    // amount (`failed`). An AMBIGUOUS failure (network timeout/connection
    // drop -- we cannot tell whether Stripe actually processed it before the
    // response was lost) must NOT release the reservation, or a naive retry
    // could double-refund at Stripe -- it's marked `unconfirmed` instead,
    // which still counts against the remaining refundable amount and
    // requires manual reconciliation.
    const definitive = isDefinitiveStripeFailure(error);
    const finalStatus = definitive ? "failed" : "unconfirmed";

    const admin = createSupabaseAdminClient();
    const { error: finalizeError } = await admin.rpc("finalize_refund", {
      p_refund_id: reservedRefund.id,
      p_status: finalStatus,
      p_stripe_refund_id: null,
    });

    if (finalizeError) {
      // Same reasoning as the success path: if this write is lost, the row
      // stays 'pending' and keeps reserving its amount forever with no
      // record of the actual (failed/unconfirmed) outcome -- log loudly so
      // it surfaces to monitoring (issue #94) instead of silently vanishing.
      console.error(
        `[refund-service] finalize_refund(${finalStatus}) failed -- refund row left in 'pending', manual reconciliation required`,
        { refundId: reservedRefund.id, error: finalizeError },
      );
    }

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: definitive ? "payment.refund_failed" : "payment.refund_unconfirmed",
      targetType: "order",
      targetId: input.orderId,
      metadata: {
        refundId: reservedRefund.id,
        paymentId: payment.id,
        amountCents: input.amountCents,
        currency: payment.currency,
        reason: input.reason,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    if (definitive) {
      throw new Error("Die Rückerstattung konnte bei Stripe nicht durchgeführt werden.");
    }

    throw new Error(
      "Die Rückerstattung bei Stripe konnte nicht bestätigt werden. Bitte den Stripe-Status manuell prüfen, bevor erneut versucht wird.",
    );
  }
}

# Refund reconciliation runbook

Scope: what to do when a `refunds` row is stuck in a state that requires a human to check the real Stripe status. See `apps/web/src/lib/payments/refund-service.ts`'s module header for the full technical background (issue #26, risk:payment; hardened per issues #93/#94).

## When you need this runbook

A refund row can require manual reconciliation in two situations:

1. **`status = 'unconfirmed'`**: `stripe.refunds.create()` failed ambiguously (network timeout/connection drop) -- Stripe may or may not have actually processed the refund. This is expected, terminal behavior, not a bug: the system deliberately refuses to guess and blocks further refund attempts against the same payment until this is resolved (issue #26 cycle-2 fix).
2. **`status = 'pending'` for longer than a few seconds**: the Stripe call either never completed or its `finalize_refund()` call itself failed (issue #94) -- check the server logs for a `finalize_refund(...) failed` entry, which includes the `refundId` and the underlying error.

## How to check the real Stripe status

1. Open the [Stripe Dashboard](https://dashboard.stripe.com/test/refunds) (test mode) and search for the refund by the tenant's connected account and the payment intent / refund amount, or use the Stripe API: `stripe refunds list --payment-intent <pi_...>`.
2. Compare against the `refunds` row: `amount_cents`, `currency`, `created_at`, and (if present) `stripe_refund_id`.

## Resolving an `unconfirmed` or stuck-`pending` row

Once you know the real outcome, update the row directly (this requires direct database access -- e.g. `psql` against `SUPABASE_DB_URL`, or the Supabase SQL editor -- there is deliberately no app-facing UI for this, since finalization is service_role-only per issue #93):

- **Stripe shows the refund succeeded**: `select finalize_refund('<refund-id>', 'succeeded', '<re_... stripe refund id>');`
- **Stripe shows no matching refund (it never happened)**: `select finalize_refund('<refund-id>', 'failed', null);` -- this releases the reserved amount and allows a genuine retry through the normal UI.
- **Genuinely still ambiguous / Stripe support ticket pending**: leave the row as `unconfirmed`; refunds against this payment stay blocked until it's resolved one way or the other.

After resolving, write a note in the tenant's audit trail if the fix diverges from what the UI would have recorded (e.g. `recordMenuAdminAuditEvent` was never called because this was a manual DB fix) -- open a follow-up if this becomes a recurring need for a dedicated audit entry type.

## Prevention / future work

- Issue #94 also covers checking/logging `finalize_refund()`'s own errors (already implemented) -- this runbook exists for the residual case where reconciliation must still happen by hand.
- A `charge.refunded`/`refund.updated` Stripe webhook listener would let the system reconcile `unconfirmed` rows automatically instead of requiring this manual runbook -- tracked as a future scoped ticket, not built yet (see the module header in `refund-service.ts`).

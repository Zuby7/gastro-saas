-- ============================================================================
-- Payment webhook processing (Epic 7, ticket #25)
-- ============================================================================
-- Ticket #25 is the ONLY place an order is allowed to become "paid"
-- (`.claude/rules/payments.md`). This migration does not add a second
-- payments/dedup table -- it reuses `payments` (ticket #24) and
-- `payment_webhook_events` (ticket #23) exactly as those tickets'
-- migrations documented, and only adds what the webhook handler needs on
-- top of them:
--
--   1. `payments.status` gains a `flagged_for_review` value: the
--      "amount mismatch is never resolved by trusting the webhook amount"
--      rule (`.claude/rules/payments.md`) requires a distinct terminal-ish
--      state that is neither paid nor failed, so a mismatched payment can be
--      queried for manual review (`select * from payments where status =
--      'flagged_for_review'`) without inventing a separate
--      ops-alerting table this ticket doesn't need.
--   2. `service_role` gets UPDATE on `payments` -- ticket #24's migration
--      deliberately withheld this ("ticket #25's migration must add it
--      deliberately, alongside its own webhook-driven update path").
--   3. A `guard_payments_immutable_fields_change()` trigger, mirroring
--      `guard_orders_payment_fields_change()`'s precedent exactly: the new
--      UPDATE grant must never become a door to silently rewrite a
--      payment's tenant/order linkage or its already-DB-verified
--      amount/currency/account -- only `status` (and `stripe_payment_intent_id`,
--      `updated_at`) may change from application code.
--
-- The webhook handler itself
-- (`apps/web/src/app/api/webhooks/stripe/route.ts`,
-- `apps/web/src/lib/payments/webhook-service.ts`) never updates
-- `orders.status` directly -- it appends to `order_status_events`
-- (already service_role-writable, ticket #21's migration), which
-- `sync_order_status_from_event()` mirrors into `orders.status`, and which
-- `validate_order_status_event()`/`is_valid_order_status_transition()`
-- (also ticket #21) reject an invalid/out-of-order transition outright --
-- no new DB object is needed for that path, it is already structurally
-- enforced.
--
-- Rollback for local/throwaway DBs:
--   drop trigger if exists payments_guard_immutable_fields_change on payments;
--   drop function if exists guard_payments_immutable_fields_change();
--   drop index if exists payments_flagged_for_review_idx;
--   revoke update on payments from service_role;
--   alter table payments drop constraint if exists payments_status_check;
--   alter table payments add constraint payments_status_check
--     check (status in ('pending', 'paid', 'failed', 'cancelled'));
-- ============================================================================

alter table payments drop constraint if exists payments_status_check;
alter table payments
  add constraint payments_status_check
  check (status in ('pending', 'paid', 'failed', 'cancelled', 'flagged_for_review'));

comment on column payments.status is
  'pending (ticket #24, session created) -> paid | failed | cancelled | flagged_for_review, set exclusively by ticket #25''s signature-verified webhook handler. flagged_for_review: the webhook amount did not match the order''s own server-calculated total -- left unpaid pending manual review, per .claude/rules/payments.md.';

-- Supports "which payments are flagged for manual review" without a
-- sequential scan as the table grows.
create index payments_flagged_for_review_idx on payments (tenant_id) where status = 'flagged_for_review';

-- ----------------------------------------------------------------------------
-- guard_payments_immutable_fields_change -- see migration header. Mirrors
-- guard_orders_payment_fields_change()'s app-facing-role/transaction-scoped
-- check exactly.
-- ----------------------------------------------------------------------------
create or replace function guard_payments_immutable_fields_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text := current_setting('role', true);
  v_is_app_facing_role boolean := v_caller_role in ('authenticated', 'anon', 'service_role');
begin
  if v_is_app_facing_role
     and (
       new.tenant_id is distinct from old.tenant_id
       or new.order_id is distinct from old.order_id
       or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
       or new.stripe_account_id is distinct from old.stripe_account_id
       or new.amount_cents is distinct from old.amount_cents
       or new.currency is distinct from old.currency
     )
  then
    raise exception
      'payments.tenant_id/order_id/stripe_checkout_session_id/stripe_account_id/amount_cents/currency are immutable once set'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function guard_payments_immutable_fields_change() is
  'Rejects changes to payments.tenant_id/order_id/stripe_checkout_session_id/stripe_account_id/amount_cents/currency from app-facing roles (ticket #25, risk:payment) -- only status/stripe_payment_intent_id/updated_at may change once a payment row exists, exclusively via the signature-verified webhook handler.';

create trigger payments_guard_immutable_fields_change
  before update on payments
  for each row
  execute function guard_payments_immutable_fields_change();

-- `service_role` needs UPDATE to transition a payment pending -> paid/
-- failed/cancelled/flagged_for_review from the webhook handler -- withheld
-- deliberately by ticket #24's migration until this ticket added the
-- guard trigger above alongside it.
grant update on payments to service_role;

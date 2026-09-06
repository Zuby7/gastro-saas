-- ============================================================================
-- Refund request idempotency (issue #97, risk:payment)
-- ============================================================================
-- Problem: two rapid, identical double-clicks of the same partial-refund
-- submission each individually pass `ensure_refund_matches_payment_and_within_limit()`'s
-- "does not exceed the paid amount" check (as long as both fit under the
-- remaining headroom) and so create two independent `refunds` rows for what
-- was meant to be a single user action -- previously only a client-side
-- disabled button guarded against this, which does not close the race
-- between two requests that were both already in flight before the button's
-- disabled state took effect.
--
-- Fix: the client now generates one `crypto.randomUUID()` request token per
-- refund *submission attempt* (see `apps/web/src/app/account/orders/[orderId]/refund-form.tsx`)
-- and sends it with the request. `refunds.request_token` is unique, so a
-- second INSERT carrying the same token as an already-existing row for that
-- payment is rejected by the database itself -- the same
-- lock-then-recheck-then-insert path already used for the amount limit
-- (`ensure_refund_matches_payment_and_within_limit()`), just one more column
-- on the same row rather than a second dedup table.
--
-- Deliberately a *permanent* uniqueness constraint, not a literal
-- expiring-time-window table: since the client always mints a fresh token
-- per new submission (and only ever repeats it across an in-flight
-- double-click of the very same submission), permanent uniqueness gives the
-- same practical "reject a repeat within a short window" effect the ticket
-- asks for, without the failure mode of a real timer-based window (a
-- double-click separated by more than the window would otherwise slip
-- through and still double-refund). Scoped to `payment_id` (not global):
-- two different payments could theoretically produce the same client UUID
-- with vanishingly small probability, and scoping keeps the dedup semantics
-- tied to the thing it's actually protecting (one payment's refund
-- attempts), matching `ensure_refund_matches_payment_and_within_limit()`'s
-- own `payment_id`-scoped queries.
--
-- Existing rows (pre-migration, if any on a non-empty dev/staging DB) get a
-- generated default so the `not null` constraint does not break history;
-- going forward, application code always supplies its own client-generated
-- token explicitly.
--
-- Rollback for local/throwaway DBs:
--   drop index if exists refunds_payment_id_request_token_idx;
--   alter table refunds drop column if exists request_token;
-- ============================================================================

alter table refunds
  add column request_token uuid not null default gen_random_uuid();

comment on column refunds.request_token is
  'Client-generated (crypto.randomUUID()) per refund submission attempt (issue #97, risk:payment). Unique per payment_id: a repeated INSERT carrying the same token as an existing row for that payment (e.g. a double-clicked submit) is rejected outright, preventing an accidental duplicate partial refund. Not itself the never-exceed-paid-amount guarantee -- that remains ensure_refund_matches_payment_and_within_limit().';

create unique index refunds_payment_id_request_token_idx
  on refunds (payment_id, request_token);

-- ----------------------------------------------------------------------------
-- guard_refunds_immutable_fields_change: request_token joins the set of
-- fields that may never change once set, alongside amount_cents/currency/
-- reason/etc -- mirrors this function's existing precedent exactly.
-- ----------------------------------------------------------------------------
create or replace function guard_refunds_immutable_fields_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text := current_setting('role', true);
  v_is_app_facing_role boolean := v_caller_role in ('authenticated', 'anon', 'service_role');
begin
  if v_is_app_facing_role then
    if new.tenant_id is distinct from old.tenant_id
       or new.payment_id is distinct from old.payment_id
       or new.order_id is distinct from old.order_id
       or new.amount_cents is distinct from old.amount_cents
       or new.currency is distinct from old.currency
       or new.reason is distinct from old.reason
       or new.actor_user_id is distinct from old.actor_user_id
       or new.request_token is distinct from old.request_token
    then
      raise exception
        'refunds.tenant_id/payment_id/order_id/amount_cents/currency/reason/actor_user_id/request_token are immutable once set'
        using errcode = 'insufficient_privilege';
    end if;

    if new.status is distinct from old.status and old.status <> 'pending' then
      raise exception 'refunds.status can only transition away from ''pending'' (current: %)', old.status
        using errcode = 'insufficient_privilege';
    end if;

    if new.status is distinct from old.status and new.status not in ('succeeded', 'failed', 'unconfirmed') then
      raise exception 'refunds.status may only become ''succeeded'', ''failed'', or ''unconfirmed'''
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

comment on function guard_refunds_immutable_fields_change() is
  'Rejects changes to refunds.tenant_id/payment_id/order_id/amount_cents/currency/reason/actor_user_id/request_token, and any status transition other than pending -> succeeded|failed|unconfirmed, from app-facing roles (ticket #26/#97, risk:payment).';

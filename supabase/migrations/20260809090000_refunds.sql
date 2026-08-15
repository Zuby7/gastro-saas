-- ============================================================================
-- Refunds (Epic 7, ticket #26, risk:payment)
-- ============================================================================
-- Adds a tenant-scoped `refunds` table: one row per Stripe refund *attempt*
-- against a `payments` row (ticket #24/#25). A single payment can accumulate
-- more than one row here (partial refunds followed by another partial
-- refund, or a retried refund after a failed Stripe call) -- `payment_id` is
-- deliberately NOT unique, matching `payments.order_id`'s own "may accumulate
-- more than one row over time" precedent.
--
-- This ticket deliberately does NOT add a `refunded`/`partially_refunded`
-- value to `payments.status`, and does NOT touch `orders.status` or the
-- order state machine (`is_valid_order_status_transition()`,
-- 20260804090000_orders_state_machine_and_checkout.sql): Stripe itself is
-- the source of truth for whether money moved, and that source of truth is
-- fully represented by this table (`refunds.status` + the sum of its
-- `succeeded` rows). The state machine's own comment already says a refund
-- is "a separate concern ... not a status transition" -- inventing a new
-- order status here would duplicate, not extend, that source of truth. If a
-- later ticket wants an "orders needing refund follow-up" view, it should
-- read this table, not a new orders.status value.
--
-- Never-exceed-paid-amount enforcement (the ticket's core acceptance
-- criterion) is done at the DB layer, inside a BEFORE INSERT trigger that
-- locks the referenced `payments` row (`select ... for update`) before
-- summing this payment's own `pending`/`succeeded`/`unconfirmed` refunds and
-- comparing against `payments.amount_cents` -- this closes the race between
-- two concurrent refund requests for the same payment (mirrors
-- `create_order_from_cart()`'s row-lock precedent for the analogous
-- duplicate-checkout race, ticket #21/Opus epic-6 finding 1). Applications
-- insert a `status = 'pending'` row *before* calling Stripe (reserving the
-- amount), then update it to `succeeded`/`failed`/`unconfirmed` afterwards --
-- only a `failed` row (a DEFINITIVE Stripe rejection) releases that reserved
-- amount; an `unconfirmed` row (an AMBIGUOUS failure, e.g. a network
-- timeout, where Stripe may have actually processed the refund) keeps
-- reserving it and requires manual reconciliation instead of an automatic
-- retry -- see `apps/web/src/lib/payments/refund-service.ts`'s module header
-- (Opus epic-7 batch review finding 1).
--
-- Two enforcement layers for `payments.refund`, per this repo's tenant-
-- isolation/RBAC standard:
--   1. Application code (`apps/web/src/lib/payments/refund-service.ts`)
--      calls `requireTenantPermission(..., 'payments.refund')` before ever
--      touching Stripe or this table.
--   2. RLS policies below independently re-check the same permission on
--      INSERT/UPDATE -- a bug or bypass in (1) can never let an
--      unauthorized session write a refund row.
--
-- Also adds the staff-facing SELECT policies on `payments`/`orders` that
-- 20260808140000_checkout_payments_stripe_checkout_session.sql's header
-- explicitly deferred to "a later ticket (#25/#26 or a payments-history
-- admin view)" -- gated on `payments.read`, matching `payment_accounts`'s
-- existing precedent for financial data.
--
-- Rollback for local/throwaway DBs:
--   drop policy if exists orders_select_payments_read on orders;
--   revoke select on orders from authenticated;
--   drop policy if exists payments_select_payments_read on payments;
--   revoke select on payments from authenticated;
--   drop trigger if exists refunds_guard_immutable_fields_change on refunds;
--   drop function if exists guard_refunds_immutable_fields_change();
--   drop trigger if exists refunds_ensure_matches_payment on refunds;
--   drop function if exists ensure_refund_matches_payment_and_within_limit();
--   drop trigger if exists refunds_set_updated_at on refunds;
--   drop table if exists refunds;
-- ============================================================================

create table refunds (
  id uuid primary key default gen_random_uuid(),
  -- `on delete restrict`: never silently lose a refund record for a tenant
  -- with payment/order history, matching payments'/orders' precedent.
  tenant_id uuid not null references tenants (id) on delete restrict,
  payment_id uuid not null references payments (id) on delete restrict,
  order_id uuid not null references orders (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(reason) > 0 and char_length(reason) <= 500),
  -- A refund is always a staff-initiated, authenticated action (never a
  -- guest path) -- unlike `payments`/`order_status_events`, there is no
  -- "no session yet" case here, so this is `not null` rather than nullable
  -- (contrast `audit_logs.actor_user_id`, which accommodates guest checkout).
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  stripe_refund_id text unique check (stripe_refund_id is null or stripe_refund_id ~ '^re_'),
  -- 'pending': reserved (this row's amount already counts against the
  -- payment's remaining refundable amount) but Stripe has not yet confirmed
  -- it. 'succeeded'/'failed'/'unconfirmed' are terminal; only 'failed'
  -- releases the reserved amount (excluded from the running total below).
  -- 'unconfirmed' (added: Opus epic-7 batch review finding 1) is for an
  -- AMBIGUOUS Stripe failure -- e.g. a network timeout/connection drop
  -- where the refund may have actually succeeded at Stripe before the
  -- response was lost. Unlike 'failed', it deliberately KEEPS counting
  -- against the running total (see
  -- ensure_refund_matches_payment_and_within_limit() below) so a naive
  -- retry with a fresh idempotency key cannot double-refund the same money
  -- at Stripe. It is a terminal, manual-reconciliation state (someone must
  -- check the real Stripe dashboard/API for what actually happened) rather
  -- than auto-retryable -- see
  -- apps/web/src/lib/payments/refund-service.ts's module header.
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'unconfirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table refunds is
  'One row per Stripe refund attempt against a payments row (ticket #26, risk:payment). Multiple partial refunds against the same payment are supported; the running total of pending+succeeded refunds can never exceed payments.amount_cents, enforced by ensure_refund_matches_payment_and_within_limit().';

create index refunds_payment_id_idx on refunds (payment_id);
create index refunds_order_id_idx on refunds (order_id);
create index refunds_tenant_id_idx on refunds (tenant_id);

create trigger refunds_set_updated_at
  before update on refunds
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- ensure_refund_matches_payment_and_within_limit -- see migration header.
-- ----------------------------------------------------------------------------
create or replace function ensure_refund_matches_payment_and_within_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_tenant_id uuid;
  v_payment_order_id uuid;
  v_payment_amount_cents integer;
  v_payment_currency text;
  v_payment_status text;
  v_already_reserved_cents integer;
begin
  -- Row lock: serializes concurrent refund attempts against the SAME
  -- payment so the "sum + new <= paid amount" check below can never race.
  select tenant_id, order_id, amount_cents, currency, status
    into v_payment_tenant_id, v_payment_order_id, v_payment_amount_cents, v_payment_currency, v_payment_status
    from public.payments
   where id = new.payment_id
     for update;

  if not found then
    raise exception 'refunds.payment_id must reference an existing payment' using errcode = 'invalid_parameter_value';
  end if;

  if v_payment_tenant_id <> new.tenant_id then
    raise exception 'refunds.tenant_id must match its payment''s tenant' using errcode = 'check_violation';
  end if;

  if v_payment_order_id <> new.order_id then
    raise exception 'refunds.order_id must match its payment''s order' using errcode = 'check_violation';
  end if;

  if new.currency <> v_payment_currency then
    raise exception 'refunds.currency must match its payment''s currency' using errcode = 'check_violation';
  end if;

  -- Only a payment Stripe has actually confirmed as paid may be refunded --
  -- never a pending/failed/cancelled/flagged_for_review payment (ticket #25:
  -- flagged_for_review means we do NOT yet trust that the amount that
  -- arrived matches the order, so it must never be treated as refundable).
  if v_payment_status <> 'paid' then
    raise exception 'Only a payment with status ''paid'' can be refunded (current status: %)', v_payment_status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_cents), 0)
    into v_already_reserved_cents
    from public.refunds
   where payment_id = new.payment_id
     and status in ('pending', 'succeeded', 'unconfirmed');

  if v_already_reserved_cents + new.amount_cents > v_payment_amount_cents then
    raise exception
      'Refund amount % (already refunded/pending: %) would exceed the paid amount % for payment %',
      new.amount_cents, v_already_reserved_cents, v_payment_amount_cents, new.payment_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function ensure_refund_matches_payment_and_within_limit() is
  'DB-level defense-in-depth (ticket #26, risk:payment): locks the referenced payments row and rejects any refunds INSERT whose tenant_id/order_id/currency does not match its payment, whose payment is not status=''paid'', or whose amount would push the running total of pending+succeeded refunds past the payment''s own paid amount_cents -- independent of and beneath apps/web/src/lib/payments/refund-service.ts''s own application-level check.';

create trigger refunds_ensure_matches_payment
  before insert on refunds
  for each row
  execute function ensure_refund_matches_payment_and_within_limit();

-- ----------------------------------------------------------------------------
-- guard_refunds_immutable_fields_change -- mirrors
-- guard_payments_immutable_fields_change()'s precedent: once a refund row
-- exists, only its lifecycle fields (status, stripe_refund_id, updated_at)
-- may ever change, and only forward (pending -> succeeded | failed |
-- unconfirmed), never backward or sideways -- this is what actually
-- finalizes a Stripe refund attempt after the server-side Stripe API call
-- resolves (or fails ambiguously -- see the status column's comment above).
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
    then
      raise exception
        'refunds.tenant_id/payment_id/order_id/amount_cents/currency/reason/actor_user_id are immutable once set'
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
  'Rejects changes to refunds.tenant_id/payment_id/order_id/amount_cents/currency/reason/actor_user_id, and any status transition other than pending -> succeeded|failed|unconfirmed, from app-facing roles (ticket #26, risk:payment).';

create trigger refunds_guard_immutable_fields_change
  before update on refunds
  for each row
  execute function guard_refunds_immutable_fields_change();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table refunds enable row level security;

revoke all on refunds from public, anon, authenticated;

grant select, insert, update on refunds to authenticated;
grant select, insert, update on refunds to service_role;
revoke truncate on refunds from anon, authenticated, service_role;

-- Viewing refund history is a "read financial data" action -- gated on
-- payments.read (same permission that already gates payment_accounts'
-- financial status), not on plain tenant membership.
create policy refunds_select_payments_read
  on refunds
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'payments.read'));

-- Issuing a refund (the initial `pending` reservation row) requires the
-- more privileged payments.refund permission, per .claude/rules/payments.md.
create policy refunds_insert_payments_refund
  on refunds
  for insert
  to authenticated
  with check (has_tenant_permission(tenant_id, 'payments.refund'));

-- Finalizing a refund (pending -> succeeded|failed|unconfirmed, once the server-side
-- Stripe call resolves) is the second half of the same privileged action --
-- also gated on payments.refund, never a lesser permission.
create policy refunds_update_payments_refund
  on refunds
  for update
  to authenticated
  using (has_tenant_permission(tenant_id, 'payments.refund'))
  with check (has_tenant_permission(tenant_id, 'payments.refund'));

-- ----------------------------------------------------------------------------
-- payments: staff-facing SELECT (deferred by ticket #24's migration to this
-- ticket) -- gated on payments.read, not plain membership, consistent with
-- financial data elsewhere in this schema.
-- ----------------------------------------------------------------------------
grant select on payments to authenticated;

create policy payments_select_payments_read
  on payments
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'payments.read'));

-- ----------------------------------------------------------------------------
-- orders: a narrow staff-facing SELECT, gated on payments.read, purely so
-- the refund admin page (this ticket's own minimal UI, ahead of Epic 8's
-- full order dashboard) can look up one order by id/tenant to show refund
-- context (status, total, customer name) through the acting user's own
-- RLS-scoped session client rather than falling back to a service-role
-- read. Epic 8 will add its own, differently-scoped orders SELECT policy for
-- the live kitchen/service dashboard -- this one is deliberately narrow and
-- not a substitute for that.
-- ----------------------------------------------------------------------------
grant select on orders to authenticated;

create policy orders_select_payments_read
  on orders
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'payments.read'));

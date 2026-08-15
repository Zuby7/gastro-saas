-- ============================================================================
-- Checkout payment creation (Epic 7, ticket #24)
-- ============================================================================
-- Adds `payments`, a tenant-scoped basic-structure ledger of Stripe Checkout
-- Sessions created for an order's destination-charge checkout (ADR-0002:
-- payment created on the platform account with `on_behalf_of` +
-- `transfer_data.destination` pointing at the tenant's connected account
-- from `payment_accounts`, ticket #23).
--
-- This ticket never marks an order (or a payment) "paid" -- that transition
-- belongs exclusively to ticket #25's signature-verified, idempotent Stripe
-- webhook handler (`.claude/rules/payments.md`). `payments.status` therefore
-- only ever takes the value 'pending' from this ticket's own code; the
-- 'paid'/'failed'/'cancelled' values exist in the check constraint so ticket
-- #25 can reuse this same table (per the ticket's own "Tabelle payments
-- (Grundstruktur)" note) instead of creating a second one. No UPDATE grant
-- is given to any role in this migration -- ticket #25's migration must add
-- it deliberately, alongside its own webhook-driven update path, rather than
-- this ticket silently leaving an update door open that nothing here uses.
--
-- Amount/currency defense-in-depth (critical total-recalculation rule): the
-- `ensure_payment_matches_order()` trigger below independently re-verifies,
-- at the moment of INSERT, that `amount_cents`/`currency` exactly match the
-- referenced order's own immutable, already-guarded
-- `orders.total_cents`/`orders.currency` snapshot (which
-- `guard_orders_payment_fields_change()` in
-- 20260804090000_orders_state_machine_and_checkout.sql already makes
-- impossible to drift after order creation) -- re-deriving the amount from
-- that immutable snapshot at payment-creation time *is* the "serverseitige
-- Neuberechnung unmittelbar vor Zahlungserstellung" this ticket's acceptance
-- criterion requires; there is no second, parallel total-calculation path
-- that could drift from it. The same trigger also independently re-verifies
-- the tenant's Stripe Connect account is charge-ready (`charges_enabled`)
-- and that `stripe_account_id` matches that tenant's own connected account
-- -- this is a second, DB-level enforcement layer beneath the application
-- code's own readiness check, so a bug or a bypassed application check can
-- never insert a payment for a not-yet-chargeable tenant.
--
-- Rollback for local/throwaway DBs:
--   drop trigger if exists payments_ensure_matches_order on payments;
--   drop function if exists ensure_payment_matches_order();
--   drop trigger if exists payments_set_updated_at on payments;
--   drop table if exists payments;
-- ============================================================================

create table payments (
  id uuid primary key default gen_random_uuid(),
  -- `on delete restrict`: never silently lose a payment record for a tenant
  -- with order/payment history, matching orders'/audit_logs' precedent.
  tenant_id uuid not null references tenants (id) on delete restrict,
  order_id uuid not null references orders (id) on delete restrict,
  -- A given order may accumulate more than one Checkout Session row over
  -- time (e.g. an old session expired and checkout was retried) -- `order_id`
  -- is therefore deliberately NOT unique; `stripe_checkout_session_id` is,
  -- so a retried request that Stripe's own idempotency layer answers with
  -- the identical session object can never produce two rows either.
  stripe_checkout_session_id text not null unique check (stripe_checkout_session_id ~ '^cs_'),
  -- Populated once Stripe returns it on the Checkout Session (often present
  -- immediately for `mode: 'payment'`); ticket #25's webhook is the
  -- authoritative source once payment completes, not this column.
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_'),
  -- The tenant's connected account (ADR-0002 destination-charge target),
  -- copied here (not just re-derived via a join) so this row remains a
  -- faithful historical record even if payment_accounts changes later.
  stripe_account_id text not null check (stripe_account_id ~ '^acct_'),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Only 'pending' is ever written by this ticket's code -- see header.
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payments is
  'Basic structure (ticket #24 "Grundstruktur"): one row per Stripe Checkout Session created for an order''s destination-charge payment (ADR-0002). status is only ever ''pending'' from this ticket -- the ''paid''/''failed''/''cancelled'' transitions are ticket #25''s signature-verified webhook''s job exclusively; no UPDATE grant exists yet.';

create index payments_order_id_idx on payments (order_id);
create index payments_tenant_id_idx on payments (tenant_id);

create trigger payments_set_updated_at
  before update on payments
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- ensure_payment_matches_order -- see migration header for the full
-- rationale. Runs as a BEFORE INSERT trigger so it can never be bypassed by
-- any INSERT path, including a future one this ticket didn't anticipate.
-- ----------------------------------------------------------------------------
create or replace function ensure_payment_matches_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant_id uuid;
  v_order_total_cents integer;
  v_order_currency text;
  v_account_id text;
  v_charges_enabled boolean;
begin
  select tenant_id, total_cents, currency
    into v_order_tenant_id, v_order_total_cents, v_order_currency
    from public.orders
   where id = new.order_id;

  if not found then
    raise exception 'payments.order_id must reference an existing order' using errcode = 'invalid_parameter_value';
  end if;

  if v_order_tenant_id <> new.tenant_id then
    raise exception 'payments.tenant_id must match its order''s tenant' using errcode = 'check_violation';
  end if;

  -- The critical total-recalculation rule: never trust a caller-supplied
  -- amount, re-verify it against the order's own immutable, already-guarded
  -- total at the moment of INSERT.
  if v_order_total_cents <> new.amount_cents or v_order_currency <> new.currency then
    raise exception
      'payments.amount_cents/currency (% %) must exactly match order %''s server-calculated total (% %)',
      new.amount_cents, new.currency, new.order_id, v_order_total_cents, v_order_currency
      using errcode = 'check_violation';
  end if;

  select stripe_account_id, charges_enabled
    into v_account_id, v_charges_enabled
    from public.payment_accounts
   where tenant_id = new.tenant_id;

  if not found or v_account_id <> new.stripe_account_id then
    raise exception 'payments.stripe_account_id must match the tenant''s own connected Stripe account'
      using errcode = 'check_violation';
  end if;

  if not v_charges_enabled then
    raise exception 'Tenant''s Stripe Connect account is not ready to accept charges (charges_enabled = false)'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function ensure_payment_matches_order() is
  'DB-level defense-in-depth (ticket #24, risk:payment): rejects any payments INSERT whose amount_cents/currency does not exactly match the referenced order''s own immutable total, whose stripe_account_id does not match the tenant''s own connected account, or whose tenant''s Connect account is not charges_enabled -- independent of and beneath the application-code checks in apps/web/src/lib/payments/service.ts.';

create trigger payments_ensure_matches_order
  before insert on payments
  for each row
  execute function ensure_payment_matches_order();

-- ----------------------------------------------------------------------------
-- RLS -- guest checkout path, no authenticated session (same "Layer 0"
-- pattern as orders/order_items above): RLS is enabled with NO policies for
-- `authenticated`/`anon` (deny-by-default), and only `service_role` (which
-- bypasses RLS) is granted access at all, exclusively via
-- `apps/web/src/lib/payments/service.ts`'s server-side checkout action path.
-- Staff-facing read access (payments.read permission) is deliberately not
-- added here -- out of this ticket's scope; a later ticket (#25/#26 or a
-- payments-history admin view) should add its own narrowly-scoped SELECT
-- policy rather than this ticket speculatively guessing its shape.
-- ----------------------------------------------------------------------------
alter table payments enable row level security;

revoke all on payments from public, anon, authenticated;

-- No UPDATE/DELETE grant at all yet -- see header note; ticket #25 adds it
-- deliberately alongside its own webhook-driven status transition.
grant select, insert on payments to service_role;

revoke truncate on payments from anon, authenticated, service_role;

-- ============================================================================
-- PayPal via Mollie Connect for Platforms (issue #195, ADR-0004, risk:payment)
-- ============================================================================
-- Additive migration. Stripe behavior is untouched.
--
-- 1. `tenant_mollie_accounts`: one Mollie OAuth connection per tenant (the
--    restaurant is the Mollie merchant of record; the platform only holds
--    OAuth tokens granted by the restaurant). Tokens are stored AES-256-GCM
--    encrypted by trusted server code (apps/web/src/lib/mollie/crypto.ts);
--    this table never holds plaintext tokens.
--    - RLS is enabled with ZERO policies and no grant at all for
--      `anon`/`authenticated`: the token columns are unreachable through
--      PostgREST for any app-facing role, even for the tenant owner.
--    - Only `service_role` (trusted server code) can read/write it.
--    - Non-secret status is exposed to members holding `payments.read` via the
--      SECURITY DEFINER RPC `get_mollie_connection_status()`.
-- 2. `payments` learns a second provider: `provider` ('stripe' | 'mollie') and
--    `mollie_payment_id`. The Stripe id columns become nullable, with a CHECK
--    that keeps each provider's required ids mandatory (a Stripe row still
--    needs its checkout session + account, a Mollie row needs its payment id).
-- 3. `ensure_payment_matches_order()` is re-created: the amount/currency/tenant
--    checks are identical for both providers; the "tenant can accept charges"
--    check uses payment_accounts for Stripe and tenant_mollie_accounts for
--    Mollie. `guard_payments_immutable_fields_change()` also freezes
--    provider/mollie_payment_id.
--
-- Mollie refund ids ('re_...') are stored in the existing
-- `refunds.stripe_refund_id` column (its '^re_' check and uniqueness hold for
-- Mollie ids too); the owning `payments.provider` says which API issued it.
-- A dedicated column would need a second finalize RPC for no safety gain.
--
-- Rollback for local/throwaway DBs (only safe with no mollie payments):
--   drop function if exists get_mollie_connection_status(uuid);
--   drop table if exists tenant_mollie_accounts;
--   alter table payments drop constraint payments_provider_ids_check;
--   alter table payments drop column mollie_payment_id, drop column provider;
--   alter table payments alter column stripe_checkout_session_id set not null;
--   alter table payments alter column stripe_account_id set not null;
--   (then restore the previous ensure_payment_matches_order /
--    guard_payments_immutable_fields_change bodies)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tenant_mollie_accounts
-- ----------------------------------------------------------------------------
create table tenant_mollie_accounts (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  mollie_organization_id text,
  mollie_profile_id text,
  -- base64 AES-256-GCM ciphertext (incl. auth tag) and 12-byte IV, bound to
  -- the tenant via GCM additional authenticated data (see crypto.ts) so a
  -- ciphertext copied to another tenant's row fails to decrypt.
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  token_expires_at timestamptz not null,
  -- 'connected': usable. 'needs_reauth': a token refresh was rejected by
  -- Mollie (revoked/expired grant) -- the restaurant must reconnect.
  status text not null default 'connected' check (status in ('connected', 'needs_reauth')),
  -- Cached result of "is PayPal activated on the merchant's Mollie profile",
  -- refreshed on connect and on demand; checkout offers PayPal only when true.
  -- Never trusted for the payment itself (Mollie rejects a disabled method).
  paypal_enabled boolean not null default false,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table tenant_mollie_accounts is
  'One Mollie OAuth connection per tenant (issue #195, ADR-0004). Token columns hold AES-256-GCM ciphertext only. No grants for anon/authenticated; service_role only. Non-secret status is exposed via get_mollie_connection_status().';

create trigger tenant_mollie_accounts_set_updated_at
  before update on tenant_mollie_accounts
  for each row
  execute function set_updated_at();

alter table tenant_mollie_accounts enable row level security;

-- Deny-by-default twice: RLS with no policies AND no table grants.
revoke all on tenant_mollie_accounts from public, anon, authenticated;
grant select, insert, update, delete on tenant_mollie_accounts to service_role;
revoke truncate on tenant_mollie_accounts from service_role;

-- ----------------------------------------------------------------------------
-- get_mollie_connection_status: non-secret status for tenant members
-- ----------------------------------------------------------------------------
create or replace function get_mollie_connection_status(p_tenant_id uuid)
returns table (
  status text,
  paypal_enabled boolean,
  mollie_profile_id text,
  connected_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  -- Same permission that gates the payments page and payment_accounts reads.
  if auth.uid() is null or not public.has_tenant_permission(p_tenant_id, 'payments.read') then
    raise exception 'Missing permission payments.read for tenant %', p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select a.status, a.paypal_enabled, a.mollie_profile_id, a.created_at
    from public.tenant_mollie_accounts a
   where a.tenant_id = p_tenant_id;
end;
$$;

comment on function get_mollie_connection_status(uuid) is
  'Non-secret Mollie connection status (status, paypal_enabled, profile id, connected_at) for members holding payments.read on the tenant. Never returns token columns.';

revoke all on function get_mollie_connection_status(uuid) from public, anon;
grant execute on function get_mollie_connection_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- payments: second provider
-- ----------------------------------------------------------------------------
alter table payments
  add column provider text not null default 'stripe' check (provider in ('stripe', 'mollie')),
  add column mollie_payment_id text unique check (mollie_payment_id is null or mollie_payment_id ~ '^tr_');

alter table payments alter column stripe_checkout_session_id drop not null;
alter table payments alter column stripe_account_id drop not null;

alter table payments
  add constraint payments_provider_ids_check check (
    (
      provider = 'stripe'
      and stripe_checkout_session_id is not null
      and stripe_account_id is not null
      and mollie_payment_id is null
    )
    or (
      provider = 'mollie'
      and mollie_payment_id is not null
      and stripe_checkout_session_id is null
      and stripe_account_id is null
      and stripe_payment_intent_id is null
    )
  );

comment on column payments.provider is
  'Which payment provider owns this row: stripe (Checkout Session, destination charge, ADR-0002) or mollie (PayPal via Mollie Connect, ADR-0004). Immutable.';
comment on column payments.mollie_payment_id is
  'Mollie payment id (tr_...) for provider = mollie. The row is only ever marked paid after the server fetched that payment from Mollie with the tenant''s own OAuth token and verified status/amount/currency/metadata.';

-- ----------------------------------------------------------------------------
-- ensure_payment_matches_order: provider-aware (Stripe branch unchanged)
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
  v_mollie_status text;
  v_mollie_paypal_enabled boolean;
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
  -- total at the moment of INSERT (both providers).
  if v_order_total_cents <> new.amount_cents or v_order_currency <> new.currency then
    raise exception
      'payments.amount_cents/currency (% %) must exactly match order %''s server-calculated total (% %)',
      new.amount_cents, new.currency, new.order_id, v_order_total_cents, v_order_currency
      using errcode = 'check_violation';
  end if;

  if new.provider = 'mollie' then
    select status, paypal_enabled
      into v_mollie_status, v_mollie_paypal_enabled
      from public.tenant_mollie_accounts
     where tenant_id = new.tenant_id;

    if not found or v_mollie_status <> 'connected' or not v_mollie_paypal_enabled then
      raise exception 'Tenant has no usable Mollie connection with PayPal enabled'
        using errcode = 'insufficient_privilege';
    end if;

    return new;
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

-- ----------------------------------------------------------------------------
-- guard_payments_immutable_fields_change: also freeze provider/mollie id
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
       or new.provider is distinct from old.provider
       or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
       or new.stripe_account_id is distinct from old.stripe_account_id
       or new.mollie_payment_id is distinct from old.mollie_payment_id
       or new.amount_cents is distinct from old.amount_cents
       or new.currency is distinct from old.currency
     )
  then
    raise exception
      'payments.tenant_id/order_id/provider/stripe_checkout_session_id/stripe_account_id/mollie_payment_id/amount_cents/currency are immutable once set'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

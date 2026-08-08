-- ============================================================================
-- Stripe Connect onboarding (Epic 7, ticket #23) -- payment_accounts + shared
-- webhook dedup scaffold
-- ============================================================================
-- Adds a tenant-scoped `payment_accounts` table tracking each tenant's
-- Stripe Express connected account and onboarding status
-- (charges_enabled/payouts_enabled/derived status), plus a
-- `payment_webhook_events` table used to verify-and-dedup incoming Stripe
-- webhook events by event ID.
--
-- `payment_webhook_events` is deliberately generic (not specific to Connect
-- `account.updated` events): ticket #25 (payment webhooks -- PaymentIntent
-- succeeded/failed, refunds) will insert into this same table rather than
-- rebuilding its own dedup mechanism, per `.claude/rules/payments.md`'s
-- "idempotent, dedup by event ID" webhook rule and this ticket's own note
-- that the two tickets share the same primitive.
--
-- Account/charge model per ADR-0002: Stripe Express accounts. This ticket
-- only implements onboarding (creating the Express account + hosted Account
-- Link + tracking status) -- ticket #24 implements the destination-charge
-- checkout flow, ticket #25 implements payment-event webhook processing.
--
-- Rollback for local/throwaway DBs:
--   drop table if exists payment_webhook_events;
--   drop table if exists payment_accounts;
-- ============================================================================

insert into permissions (key, description)
values ('payments.read', 'Read Stripe Connect onboarding/payment account status')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as `tenant.settings.write` in
-- 20260801110000_restaurant_profile_and_menu_management.sql. Manager also
-- gets it, consistent with Manager already holding `payments.refund`.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'payments.read'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'payments.read')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- The two inserts above only backfill *existing* tenants at
-- migration-apply time. `seed_standard_roles_for_tenant()`
-- (20260801080000_roles_and_permissions_rbac.sql) seeds Manager's default
-- grants for *new* tenants from a hardcoded VALUES list baked into that
-- function body -- later tickets that added permission keys (
-- tenant.settings.write, menu.write, menu.read) never updated that list, so
-- new tenants' Managers silently never got those either. Out of scope to
-- backfill those historical gaps here, but `payments.read` is this ticket's
-- own new permission, so this replace adds it to the function going
-- forward (otherwise every tenant created after this migration would
-- misreport "Manager can view payment status" per the ticket's own
-- "Berechtigungen" note while actually being denied by RLS). The function
-- body is otherwise byte-for-byte identical to the original.
create or replace function seed_standard_roles_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_role_id uuid;
  v_manager_role_id uuid;
  v_kitchen_role_id uuid;
  v_service_role_id uuid;
  v_marketing_role_id uuid;
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  values
    (new.id, 'owner', 'Owner', 'Full tenant administration and safety-critical permissions.', true),
    (new.id, 'manager', 'Manager', 'Operational tenant management without role-template administration.', true),
    (new.id, 'kitchen', 'Kitchen', 'Kitchen workflow access only.', true),
    (new.id, 'service', 'Service', 'Service and order workflow access.', true),
    (new.id, 'marketing', 'Marketing', 'Menu publishing and analytics access without payment authority.', true)
  on conflict (tenant_id, key) do update
     set name = excluded.name,
         description = excluded.description,
         is_system = true;

  select id into v_owner_role_id from public.roles where tenant_id = new.id and key = 'owner';
  select id into v_manager_role_id from public.roles where tenant_id = new.id and key = 'manager';
  select id into v_kitchen_role_id from public.roles where tenant_id = new.id and key = 'kitchen';
  select id into v_service_role_id from public.roles where tenant_id = new.id and key = 'service';
  select id into v_marketing_role_id from public.roles where tenant_id = new.id and key = 'marketing';

  insert into public.role_permissions (role_id, permission_key)
  select v_owner_role_id, key from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_key)
  values
    (v_manager_role_id, 'users.invite'),
    (v_manager_role_id, 'users.manage'),
    (v_manager_role_id, 'menu.publish'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.cancel'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- payment_accounts: one Stripe Express connected account per tenant
-- ----------------------------------------------------------------------------
create table payment_accounts (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_'),
  -- Derived summary, not the raw Stripe `requirements` blob -- live detail is
  -- re-fetched from Stripe when displayed rather than kept in perfect sync
  -- here. `pending`: onboarding started but Stripe has not yet enabled
  -- charges/payouts. `restricted`: Stripe flagged outstanding requirements
  -- (currently_due/past_due/disabled_reason). `enabled`: charges_enabled and
  -- payouts_enabled are both true.
  status text not null default 'pending' check (status in ('pending', 'restricted', 'enabled')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  requirements_summary text,
  onboarding_started_at timestamptz not null default now(),
  onboarding_completed_at timestamptz,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payment_accounts is
  'One Stripe Express connected account per tenant (ticket #23). Onboarding status only -- charge/payout execution is ticket #24/#25.';

create trigger payment_accounts_set_updated_at
  before update on payment_accounts
  for each row
  execute function set_updated_at();

alter table payment_accounts enable row level security;

-- Same-model self-check finding (fixed before shipping, ticket #23 is
-- risk:payment): `authenticated` intentionally gets no UPDATE/DELETE grant
-- at all on this table -- only SELECT and INSERT (to create the initial row
-- when starting onboarding). charges_enabled/payouts_enabled/status/
-- requirements_summary must only ever be written by trusted server code
-- that just verified the real state with Stripe (the return_url page's
-- synchronous Retrieve Account call, or the signature-verified
-- account.updated webhook) -- both go through `createSupabaseAdminClient()`
-- (service_role), never the caller's own session client. Without this, an
-- RLS policy that only checked `has_tenant_permission(tenant_id,
-- 'payments.read')` on UPDATE would let any Manager/Owner directly
-- `update payment_accounts set status = 'enabled', charges_enabled = true`
-- on their own tenant's row through the Supabase client library, self
-- declaring their account production-ready without Stripe ever verifying
-- anything.
grant select, insert on payment_accounts to authenticated;
grant select, insert, update, delete on payment_accounts to service_role;
revoke truncate on payment_accounts from anon, authenticated, service_role;

-- Reads and the one-time initial insert both require `payments.read` --
-- unlike apply_basic_tenant_policies()'s default (plain tenant membership
-- for select), financial connection status is not something every tenant
-- member should see, per the ticket's own permission note. There is no
-- separate "initiate onboarding" permission key today; `payments.read`
-- gates both, same as `tenant.settings.write` gates both read and write of
-- restaurant_profiles for the settings surface it protects.
create policy payment_accounts_select_payments_read
  on payment_accounts
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'payments.read'));

create policy payment_accounts_insert_payments_read
  on payment_accounts
  for insert
  to authenticated
  with check (has_tenant_permission(tenant_id, 'payments.read'));

-- No update/delete policy for `authenticated`: there is no corresponding
-- grant (see above), so these would be unreachable anyway -- kept absent
-- rather than added-then-unreachable to avoid implying a boundary that
-- isn't actually there. `service_role` bypasses RLS entirely for its own
-- update/delete grants (status sync, support/ops use).

-- ----------------------------------------------------------------------------
-- payment_webhook_events: signature-verified, deduped Stripe webhook receipts
-- ----------------------------------------------------------------------------
-- Not tenant-scoped: Stripe Connect webhooks (and, later, platform-account
-- payment webhooks per ADR-0002) arrive without tenant context in the
-- request itself -- the tenant is resolved from the event payload
-- (connected account ID) *after* signature verification, inside the
-- webhook handler, using a service-role client. No `authenticated`/`anon`
-- access is granted; only the trusted server-side webhook route (service
-- role) reads/writes this table.
create table payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  stripe_account_id text,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table payment_webhook_events is
  'Dedup ledger for verified Stripe webhook events (event ID unique). Shared primitive: ticket #23 uses it for Connect account.updated events, ticket #25 will reuse it for payment events -- do not create a second dedup table.';

alter table payment_webhook_events enable row level security;

grant select, insert, update on payment_webhook_events to service_role;
revoke all on payment_webhook_events from anon, authenticated;
revoke truncate on payment_webhook_events from service_role;

-- Deliberately no policies for `authenticated`/`anon` -- RLS with zero
-- policies denies all access to those roles by default, and they hold no
-- table grants either (belt and suspenders).

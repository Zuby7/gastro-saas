-- ============================================================================
-- Order state machine and guest checkout (Epic 6, ticket #21)
-- ============================================================================
-- Adds `orders`, `order_items`, `order_item_selections`,
-- `order_status_events` -- converting a checkout-ready guest cart (ticket
-- #20, see 20260803090000_cart_server_side_pricing.sql) into a durable,
-- immutable order.
--
-- Guest write model -- identical architecture to the cart tables (see that
-- migration's header note in full; not re-derived here). In short: RLS is
-- enabled on every table below with NO policies at all (deny-by-default for
-- `anon`/`authenticated`), and every table's only granted role is
-- `service_role`; all reads/writes happen exclusively through the
-- SECURITY DEFINER RPC below, called by the Next.js server via the
-- service-role client, which resolves `tenant_id` from the public route
-- slug server-side (never a client-supplied value) -- see
-- docs/security/tenant-isolation.md Layer 0. `service_role` is intentionally
-- included in every guard trigger's "is this an app-facing role" check
-- below (mirroring `guard_menu_versions_status_change()`'s precedent) so
-- that even the service-role client cannot bypass the state machine except
-- through the sanctioned RPC/trigger path.
--
-- Pricing (never trust a client-calculated total, CLAUDE.md's payments
-- rule): `create_order_from_cart()` re-runs the exact same live
-- price/availability recalculation the cart already performs
-- (`build_cart_view()`) at the moment of checkout, and refuses to create an
-- order at all unless that fresh recalculation reports `checkoutReady`.
-- `orders.total_cents` and every `order_items.unit_price_cents_snapshot` are
-- always derived from that server-side recalculation, never from any
-- client-supplied field.
--
-- Snapshot immutability (ticket #21 acceptance criterion 2 /
-- docs/data/domain-model.md "Order immutability" /
-- .claude/rules/database-migrations.md): `order_items`/`order_item_selections`
-- copy name/price/variant/option-extras (and a placeholder tax rate, see
-- `order_items.tax_rate_snapshot` comment below) at the moment of purchase
-- and are then immutable (insert-only; UPDATE/DELETE rejected for app-facing
-- roles, mirroring `reject_audit_log_mutation()`'s precedent) -- a later
-- edit or archive of the live `dishes`/`dish_variants`/`options` rows must
-- never retroactively change a historical order.
--
-- State machine (packages/domain/src/orders/state-machine.ts is the
-- canonical, unit-tested pure representation; `is_valid_order_status_transition()`
-- below mirrors it exactly and is the actual DB-level source-of-truth
-- enforcement -- this repo's established "two enforcement layers"
-- philosophy, see `guard_menu_versions_status_change()`'s precedent in
-- 20260801110000_restaurant_profile_and_menu_management.sql):
--   awaiting_payment -> received -> accepted -> preparing -> ready -> completed
--   (any of awaiting_payment/received/accepted/preparing) -> cancelled
-- `orders.status` is a denormalized "current status" column, kept in sync
-- exclusively by inserting into the append-only, immutable
-- `order_status_events` audit trail (event-sourced pattern) -- direct
-- `UPDATE`s to `orders.status` are rejected for app-facing roles unless
-- performed by `sync_order_status_from_event()` itself (a transaction-local
-- allow-flag, mirroring `guard_menu_versions_status_change()`'s flag).
--
-- Fulfillment types: this ticket implements `pickup` and `table` only (no
-- delivery option -- explicit non-goal). `delivery` is included in the
-- `fulfillment_type` check constraint purely as a feature-flag placeholder
-- for a later ticket; `create_order_from_cart()` itself rejects it today.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists create_order_from_cart(uuid, uuid, text, text, text, text, text, text);
--   drop trigger if exists order_status_events_sync_order_status on order_status_events;
--   drop function if exists sync_order_status_from_event();
--   drop trigger if exists order_status_events_validate on order_status_events;
--   drop function if exists validate_order_status_event();
--   drop function if exists is_valid_order_status_transition(text, text);
--   drop trigger if exists orders_guard_status_change on orders;
--   drop function if exists guard_orders_status_change();
--   drop trigger if exists order_items_immutable on order_items;
--   drop trigger if exists order_items_immutable_truncate on order_items;
--   drop trigger if exists order_item_selections_immutable on order_item_selections;
--   drop trigger if exists order_item_selections_immutable_truncate on order_item_selections;
--   drop trigger if exists order_status_events_immutable on order_status_events;
--   drop trigger if exists order_status_events_immutable_truncate on order_status_events;
--   drop function if exists reject_order_history_mutation();
--   drop trigger if exists order_items_tenant_match on order_items;
--   drop trigger if exists order_item_selections_tenant_match on order_item_selections;
--   drop trigger if exists order_status_events_tenant_match on order_status_events;
--   drop function if exists ensure_order_row_tenant_match();
--   drop trigger if exists orders_set_updated_at on orders;
--   drop table if exists order_status_events;
--   drop table if exists order_item_selections;
--   drop table if exists order_items;
--   drop table if exists orders;
--   alter table auth_rate_limit_attempts drop constraint if exists auth_rate_limit_attempts_scope_check;
--   alter table auth_rate_limit_attempts add constraint auth_rate_limit_attempts_scope_check check (scope in ('login', 'register'));
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extend the existing auth rate limiter's scope enum with 'checkout' (ticket
-- #21's "rate-limit checkout" requirement, .claude/rules/backend-api.md) --
-- reusing the exact same reserve-and-count RPCs/table from
-- 20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql rather than
-- inventing a second rate-limit mechanism.
-- ----------------------------------------------------------------------------
alter table auth_rate_limit_attempts drop constraint if exists auth_rate_limit_attempts_scope_check;
alter table auth_rate_limit_attempts
  add constraint auth_rate_limit_attempts_scope_check check (scope in ('login', 'register', 'checkout'));

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  -- `on delete restrict`: a tenant with existing order history can never be
  -- deleted implicitly, matching audit_logs' precedent.
  tenant_id uuid not null references tenants (id) on delete restrict,
  -- The cart this order was created from -- purely informational/traceability;
  -- `on delete set null` since carts are ephemeral and may be pruned later,
  -- while the order itself must survive regardless.
  cart_id uuid references carts (id) on delete set null,
  -- SHA-256 hex of an opaque, single-purpose guest access token (never the
  -- cart token -- a distinct token per purpose, per
  -- docs/security/tenant-isolation.md Layer 0). Ticket #22's guest-facing
  -- order-status page will look an order up by this hash. The raw token
  -- never reaches the database, mirroring carts.cart_token_hash /
  -- invitations.token_hash.
  guest_access_token_hash text not null unique check (guest_access_token_hash ~ '^[a-f0-9]{64}$'),
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'table', 'delivery')),
  customer_name text not null check (char_length(customer_name) > 0 and char_length(customer_name) <= 200),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 40),
  table_identifier text check (table_identifier is null or char_length(table_identifier) <= 40),
  customer_note text not null default '' check (char_length(customer_note) <= 500),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  -- Always the result of build_cart_view()'s server-side recalculation at
  -- checkout time -- never a client-supplied value (see migration header).
  total_cents integer not null check (total_cents >= 0),
  -- Denormalized current status, kept in sync exclusively by
  -- sync_order_status_from_event() below -- see migration header.
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Checkout only collects the data actually needed for the chosen
  -- fulfillment type (acceptance criterion 3): a pickup order never carries
  -- a table identifier; a table order always carries one. `delivery` has no
  -- fields of its own yet (feature-flag placeholder, see header).
  constraint orders_fulfillment_fields_match_type check (
    case fulfillment_type
      when 'pickup' then table_identifier is null
      when 'table' then table_identifier is not null and char_length(table_identifier) > 0
      else true
    end
  )
);

create trigger orders_set_updated_at
  before update on orders
  for each row
  execute function set_updated_at();

create index orders_tenant_id_idx on orders (tenant_id);
create index orders_tenant_id_status_idx on orders (tenant_id, status);
create index orders_cart_id_idx on orders (cart_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  -- Plain (non-enforced-immutable) references to the live menu rows, kept
  -- only for traceability/analytics (e.g. "how often was this dish
  -- ordered") -- `on delete set null` because the dish/variant may later be
  -- archived or hard-deleted from an old draft; that must never cascade
  -- into deleting order history. Every column actually needed to display or
  -- re-derive this line item is snapshotted below, independent of these ids.
  dish_id uuid references dishes (id) on delete set null,
  dish_variant_id uuid references dish_variants (id) on delete set null,
  quantity integer not null check (quantity > 0 and quantity <= 20),
  -- Immutable purchase-time snapshot (ticket #21 acceptance criterion 2):
  -- name, price, variant, and (via order_item_selections) extras are all
  -- copied here and never re-read from the live menu again.
  dish_name_snapshot text not null,
  variant_name_snapshot text,
  unit_price_cents_snapshot integer not null check (unit_price_cents_snapshot >= 0),
  -- Tax categories (docs/data/domain-model.md "Tax") are not implemented by
  -- any ticket yet -- this column exists now so order_items already has the
  -- full immutable snapshot shape ticket #21's acceptance criteria require
  -- ("Name/Preis/Steuer/Variante/Extras"), defaulting to 0 until a future
  -- tax-categories ticket populates it from a real per-dish/fulfillment rate.
  tax_rate_snapshot numeric(5, 4) not null default 0 check (tax_rate_snapshot >= 0 and tax_rate_snapshot <= 1),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on order_items (order_id);
create index order_items_tenant_id_idx on order_items (tenant_id);

create table order_item_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_item_id uuid not null references order_items (id) on delete cascade,
  option_id uuid references options (id) on delete set null,
  -- Immutable snapshot, same rationale as order_items above.
  option_name_snapshot text not null,
  price_delta_cents_snapshot integer not null,
  created_at timestamptz not null default now()
);

create index order_item_selections_order_item_id_idx on order_item_selections (order_item_id);
create index order_item_selections_tenant_id_idx on order_item_selections (tenant_id);

create table order_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  -- null only for the very first event (order creation) -- see
  -- is_valid_order_status_transition() below.
  from_status text check (
    from_status is null
    or from_status in ('awaiting_payment', 'received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')
  ),
  to_status text not null
    check (to_status in ('awaiting_payment', 'received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  -- Who caused this transition, if known. null for the guest-driven
  -- creation event and for any future system-driven transition (e.g. a
  -- Stripe webhook, Epic 7); populated with a staff user id once Epic 8's
  -- kitchen workflow starts appending its own transitions.
  actor_user_id uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index order_status_events_order_id_idx on order_status_events (order_id, created_at);
create index order_status_events_tenant_id_idx on order_status_events (tenant_id);

comment on table order_status_events is
  'Append-only, immutable audit trail of every order status transition (event-sourced pattern) -- orders.status is a denormalized "current status" column kept in sync exclusively from this table by sync_order_status_from_event(). See docs/data/domain-model.md "Ordering" and packages/domain/src/orders/state-machine.ts for the canonical transition table this enforces.';

-- ----------------------------------------------------------------------------
-- Same-tenant integrity guard, mirroring ensure_cart_row_tenant_match() /
-- ensure_menu_child_tenant_match() precedent.
-- ----------------------------------------------------------------------------
create or replace function ensure_order_row_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  if tg_table_name = 'order_items' then
    select tenant_id into v_expected_tenant_id from public.orders where id = new.order_id;
    if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
      raise exception 'order_items.tenant_id must match its order' using errcode = 'check_violation';
    end if;
    if new.dish_id is not null then
      perform 1 from public.dishes where id = new.dish_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'order_items.dish_id must belong to the same tenant'
          using errcode = 'check_violation';
      end if;
    end if;
    if new.dish_variant_id is not null then
      perform 1 from public.dish_variants where id = new.dish_variant_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'order_items.dish_variant_id must belong to the same tenant'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'order_item_selections' then
    select tenant_id into v_expected_tenant_id from public.order_items where id = new.order_item_id;
    if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
      raise exception 'order_item_selections.tenant_id must match its order item'
        using errcode = 'check_violation';
    end if;
    if new.option_id is not null then
      perform 1 from public.options where id = new.option_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'order_item_selections.option_id must belong to the same tenant'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'order_status_events' then
    select tenant_id into v_expected_tenant_id from public.orders where id = new.order_id;
    if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
      raise exception 'order_status_events.tenant_id must match its order'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger order_items_tenant_match
  before insert or update on order_items
  for each row execute function ensure_order_row_tenant_match();

create trigger order_item_selections_tenant_match
  before insert or update on order_item_selections
  for each row execute function ensure_order_row_tenant_match();

create trigger order_status_events_tenant_match
  before insert or update on order_status_events
  for each row execute function ensure_order_row_tenant_match();

-- ----------------------------------------------------------------------------
-- Immutability guards for historical/audit data (order_items,
-- order_item_selections, order_status_events) -- mirrors
-- reject_audit_log_mutation()'s precedent exactly: app-facing roles
-- (including service_role) can never UPDATE/DELETE/TRUNCATE these rows;
-- only a non-app-facing (direct superuser/migration/ops) connection can.
-- ----------------------------------------------------------------------------
create or replace function reject_order_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := current_setting('role', true);
  is_app_facing_role boolean := caller_role in ('authenticated', 'anon', 'service_role');
begin
  if tg_op = 'TRUNCATE' then
    if is_app_facing_role then
      raise exception '% is append-only: TRUNCATE is never permitted for %.', tg_table_name, caller_role
        using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;

  if is_app_facing_role then
    raise exception '% is immutable once written: % is never permitted for %.', tg_table_name, tg_op, caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function reject_order_history_mutation() is
  'Rejects UPDATE/DELETE/TRUNCATE on order_items/order_item_selections/order_status_events for app-facing roles (authenticated/anon/service_role) -- these are immutable purchase-time snapshots and an append-only audit trail respectively (ticket #21 acceptance criterion 2). Mirrors reject_audit_log_mutation()''s precedent, including its non-app-facing-caller exemption for privileged maintenance connections.';

create trigger order_items_immutable
  before update or delete on order_items
  for each row execute function reject_order_history_mutation();

create trigger order_items_immutable_truncate
  before truncate on order_items
  for each statement execute function reject_order_history_mutation();

create trigger order_item_selections_immutable
  before update or delete on order_item_selections
  for each row execute function reject_order_history_mutation();

create trigger order_item_selections_immutable_truncate
  before truncate on order_item_selections
  for each statement execute function reject_order_history_mutation();

create trigger order_status_events_immutable
  before update or delete on order_status_events
  for each row execute function reject_order_history_mutation();

create trigger order_status_events_immutable_truncate
  before truncate on order_status_events
  for each statement execute function reject_order_history_mutation();

-- ----------------------------------------------------------------------------
-- orders.status guard: direct UPDATEs to status are rejected for app-facing
-- roles unless sync_order_status_from_event() itself is performing the
-- sanctioned, already-validated update -- mirrors
-- guard_menu_versions_status_change()'s transaction-local allow-flag
-- pattern exactly.
-- ----------------------------------------------------------------------------
create or replace function guard_orders_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text := current_setting('role', true);
  v_is_app_facing_role boolean := v_caller_role in ('authenticated', 'anon', 'service_role');
  v_allow_flag text := current_setting('gastro_saas.allow_order_status_change', true);
begin
  if new.status is distinct from old.status
     and v_is_app_facing_role
     and coalesce(v_allow_flag, 'off') <> 'on'
  then
    raise exception 'orders.status can only be changed by appending an order_status_events row'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function guard_orders_status_change() is
  'Rejects direct orders.status transitions from app-facing roles unless the transaction-local gastro_saas.allow_order_status_change flag is set to on (only sync_order_status_from_event() sets it, and only around its own sanctioned status UPDATE). Mirrors guard_menu_versions_status_change()''s precedent.';

create trigger orders_guard_status_change
  before update on orders
  for each row
  execute function guard_orders_status_change();

-- ----------------------------------------------------------------------------
-- is_valid_order_status_transition -- the DB-level mirror of
-- packages/domain/src/orders/state-machine.ts's ORDER_STATUS_TRANSITIONS.
-- Keep both in sync by hand if this table ever changes; there is no
-- automated cross-check between the two (same limitation already accepted
-- for build_cart_view() vs. calculateCartPricing()).
-- ----------------------------------------------------------------------------
create or replace function is_valid_order_status_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from is null then p_to = 'awaiting_payment'
    when p_from = 'awaiting_payment' then p_to in ('received', 'cancelled')
    when p_from = 'received' then p_to in ('accepted', 'cancelled')
    when p_from = 'accepted' then p_to in ('preparing', 'cancelled')
    when p_from = 'preparing' then p_to in ('ready', 'cancelled')
    when p_from = 'ready' then p_to in ('completed')
    else false
  end;
$$;

-- ----------------------------------------------------------------------------
-- validate_order_status_event -- rejects an invalid transition (acceptance
-- criterion 1) at the moment an order_status_events row is inserted,
-- regardless of caller (even a hypothetical future direct INSERT bypassing
-- append_order_status_event()/create_order_from_cart() below would still be
-- caught here) -- also verifies from_status truthfully reflects the order's
-- actual current status, so a caller cannot fabricate a fake "from" value.
-- ----------------------------------------------------------------------------
create or replace function validate_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_has_prior_event boolean;
begin
  select exists(
    select 1 from public.order_status_events where order_id = new.order_id
  ) into v_has_prior_event;

  -- orders.status carries a NOT NULL default ('awaiting_payment', set at
  -- INSERT time by create_order_from_cart() before this, the row's very
  -- first event, is inserted) purely so the column can stay NOT NULL --
  -- it does not mean a real transition already happened. The first event
  -- for any order must therefore always have from_status = null, checked
  -- against "no prior event exists" rather than against orders.status.
  if not v_has_prior_event then
    if new.from_status is not null then
      raise exception 'order_status_events.from_status (%) must be null for an order''s first event',
        new.from_status
        using errcode = 'check_violation';
    end if;
  else
    select status into v_current_status from public.orders where id = new.order_id;

    if new.from_status is distinct from v_current_status then
      raise exception 'order_status_events.from_status (%) does not match the order''s actual current status (%)',
        coalesce(new.from_status, '(null)'), coalesce(v_current_status, '(null)')
        using errcode = 'check_violation';
    end if;
  end if;

  if not public.is_valid_order_status_transition(new.from_status, new.to_status) then
    raise exception 'Invalid order status transition: % -> %', coalesce(new.from_status, '(new order)'), new.to_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_status_events_validate
  before insert on order_status_events
  for each row execute function validate_order_status_event();

-- ----------------------------------------------------------------------------
-- sync_order_status_from_event -- the ONLY path that ever changes
-- orders.status, keeping the denormalized column in sync with the
-- append-only event trail it was just validated against above.
-- ----------------------------------------------------------------------------
create or replace function sync_order_status_from_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('gastro_saas.allow_order_status_change', 'on', true);

  update public.orders
     set status = new.to_status
   where id = new.order_id;

  perform set_config('gastro_saas.allow_order_status_change', 'off', true);

  return new;
end;
$$;

create trigger order_status_events_sync_order_status
  after insert on order_status_events
  for each row execute function sync_order_status_from_event();

-- ----------------------------------------------------------------------------
-- RLS -- enabled, deliberately with NO policies (see header note): every
-- app-facing role is denied by default; only service_role (bypassrls) can
-- reach these tables, and only through create_order_from_cart() below (plus
-- future append-status-event RPCs, Epic 8).
-- ----------------------------------------------------------------------------
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_item_selections enable row level security;
alter table order_status_events enable row level security;

revoke all on orders, order_items, order_item_selections, order_status_events
  from public, anon, authenticated;

-- orders: no delete grant -- an order is cancelled (a status transition),
-- never deleted.
grant select, insert, update on orders to service_role;
-- order_items/order_item_selections/order_item_selections: no update/delete
-- grant -- see the immutability guards above.
grant select, insert on order_items to service_role;
grant select, insert on order_item_selections to service_role;
grant select, insert on order_status_events to service_role;

revoke truncate on orders, order_items, order_item_selections, order_status_events
  from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- create_order_from_cart -- the sole checkout entry point. Re-verifies the
-- cart belongs to p_tenant_id, re-runs the live price/availability
-- recalculation (build_cart_view(), same function the cart itself uses),
-- refuses to proceed unless checkoutReady, then atomically creates the
-- order + snapshotted order_items/order_item_selections + the initial
-- order_status_events row, and clears the now-converted cart.
-- ----------------------------------------------------------------------------
create or replace function create_order_from_cart(
  p_cart_id uuid,
  p_tenant_id uuid,
  p_fulfillment_type text,
  p_customer_name text,
  p_customer_phone text,
  p_table_identifier text,
  p_customer_note text,
  p_guest_access_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_view jsonb;
  v_currency text;
  v_order_id uuid;
  v_order_item_id uuid;
  v_item jsonb;
  v_selection jsonb;
begin
  perform 1 from public.carts where id = p_cart_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Cart not found' using errcode = 'invalid_parameter_value';
  end if;

  -- Non-goal (explicit): no delivery fulfillment yet -- 'delivery' exists
  -- only as a feature-flag placeholder in the check constraint.
  if p_fulfillment_type not in ('pickup', 'table') then
    raise exception 'This fulfillment type is not yet supported' using errcode = 'invalid_parameter_value';
  end if;

  if p_customer_name is null or char_length(btrim(p_customer_name)) = 0 then
    raise exception 'Customer name is required' using errcode = 'invalid_parameter_value';
  end if;

  if p_fulfillment_type = 'table'
     and (p_table_identifier is null or char_length(btrim(p_table_identifier)) = 0)
  then
    raise exception 'Table identifier is required for table orders' using errcode = 'invalid_parameter_value';
  end if;

  if p_guest_access_token_hash is null or p_guest_access_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest access token' using errcode = 'invalid_parameter_value';
  end if;

  -- Never trust a client-calculated total: re-run the exact same live
  -- recalculation the cart uses, at the moment of checkout, not whatever
  -- the guest last saw rendered.
  v_cart_view := public.build_cart_view(p_cart_id);

  if coalesce((v_cart_view ->> 'itemCount')::int, 0) = 0 then
    raise exception 'Cart is empty' using errcode = 'invalid_parameter_value';
  end if;

  if not coalesce((v_cart_view ->> 'checkoutReady')::boolean, false) then
    raise exception 'Cart is not ready for checkout' using errcode = 'invalid_parameter_value';
  end if;

  v_currency := v_cart_view ->> 'currency';

  insert into public.orders (
    tenant_id, cart_id, guest_access_token_hash, fulfillment_type,
    customer_name, customer_phone, table_identifier, customer_note,
    currency, total_cents, status
  )
  values (
    p_tenant_id, p_cart_id, p_guest_access_token_hash, p_fulfillment_type,
    btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    nullif(btrim(coalesce(p_table_identifier, '')), ''),
    coalesce(btrim(p_customer_note), ''),
    v_currency,
    (v_cart_view ->> 'totalCents')::int,
    'awaiting_payment'
  )
  returning id into v_order_id;

  -- Initial status event: orders.status is already 'awaiting_payment' from
  -- the insert default above (no UPDATE, so the orders_guard_status_change
  -- trigger is not involved here) -- this row exists purely to make the
  -- creation event visible in the append-only audit trail from the start.
  insert into public.order_status_events (tenant_id, order_id, from_status, to_status)
  values (p_tenant_id, v_order_id, null, 'awaiting_payment');

  for v_item in select * from jsonb_array_elements(v_cart_view -> 'items')
  loop
    insert into public.order_items (
      tenant_id, order_id, dish_id, dish_variant_id, quantity,
      dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot, currency
    )
    values (
      p_tenant_id, v_order_id,
      (v_item ->> 'dishId')::uuid,
      (v_item ->> 'variantId')::uuid,
      (v_item ->> 'quantity')::int,
      v_item ->> 'dishName',
      v_item ->> 'variantName',
      (v_item ->> 'unitPriceCents')::int,
      v_currency
    )
    returning id into v_order_item_id;

    for v_selection in select * from jsonb_array_elements(coalesce(v_item -> 'selections', '[]'::jsonb))
    loop
      insert into public.order_item_selections (
        tenant_id, order_item_id, option_id, option_name_snapshot, price_delta_cents_snapshot
      )
      values (
        p_tenant_id, v_order_item_id,
        (v_selection ->> 'optionId')::uuid,
        v_selection ->> 'name',
        (v_selection ->> 'priceDeltaCents')::int
      );
    end loop;
  end loop;

  -- The cart is now converted into an order -- clear its line items so the
  -- guest cannot re-checkout the same items again from a stale cart.
  delete from public.cart_items where cart_id = p_cart_id;

  return jsonb_build_object(
    'orderId', v_order_id,
    'status', 'awaiting_payment',
    'totalCents', (v_cart_view ->> 'totalCents')::int,
    'currency', v_currency
  );
end;
$$;

revoke all on function create_order_from_cart(uuid, uuid, text, text, text, text, text, text) from public;
grant execute on function create_order_from_cart(uuid, uuid, text, text, text, text, text, text) to service_role;

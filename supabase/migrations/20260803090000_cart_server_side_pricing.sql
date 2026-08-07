-- ============================================================================
-- Cart with server-side price recalculation (Epic 6, ticket #20)
-- ============================================================================
-- Adds `carts`, `cart_items`, `cart_item_selections` -- a guest/anonymous
-- shopping cart, tenant-scoped, identified by an opaque token (never a
-- Supabase Auth session -- see docs/security/tenant-isolation.md "Layer 0").
--
-- Guest write model (per tenant-isolation.md Layer 0 and CLAUDE.md's payments
-- rule "never trust a client-calculated total"):
--   - There are NO grants to `anon` on these tables or their RPC functions.
--     A guest never talks to Postgres directly with the anon key for cart
--     writes/reads; the only caller is the Next.js server (Server
--     Actions/Route Handlers) using the service-role client
--     (apps/web/src/lib/supabase/admin.ts), which resolves tenant_id from the
--     public route slug server-side and is the sole thing allowed to write
--     on a guest's behalf.
--   - RLS is still enabled on all three tables (defense in depth / satisfies
--     "every tenant-scoped table ships RLS in the same migration"), but with
--     NO policies at all -- an app-facing `authenticated`/`anon` session is
--     denied by default; `service_role` bypasses RLS entirely (Supabase's
--     `service_role` has `bypassrls`), which is why every RPC function below
--     re-verifies `p_tenant_id` against the cart's actual `tenant_id` itself
--     rather than relying on RLS to catch a cross-tenant mistake.
--   - The raw cart token is generated app-side (256-bit random, see
--     apps/web/src/lib/cart/token.ts) and stored httpOnly-cookie-only; only
--     its SHA-256 hash reaches this table, mirroring the invitations token
--     pattern in 20260801100000_invitations.sql.
--
-- Pricing model (acceptance criterion 1: the displayed total always comes
-- from a fresh server-side recalculation, never a client value):
--   - `cart_items`/`cart_item_selections` only store *identity*
--     (dish/variant/option ids + a display-only name snapshot for when a
--     dish is later archived) and quantity -- never a price. There is no
--     "last known price" column to go stale or be trusted by mistake.
--   - Every read (`get_cart_view`) and every mutation
--     (`add_cart_item`/`update_cart_item_quantity`/`remove_cart_item`, which
--     all end by calling the same view builder) recomputes unit prices,
--     option price deltas, and availability by joining the *current* live
--     `dishes`/`dish_variants`/`options`/`menu_versions` rows, mirroring the
--     pure algorithm unit-tested in
--     packages/domain/src/cart/pricing.ts (`calculateCartPricing`).
--   - A dish/variant that is archived, unavailable, or no longer part of the
--     tenant's currently published menu version (acceptance criterion 2) is
--     excluded from `totalCents` and flagged `isAvailable: false` on its
--     line; `checkoutReady` is false whenever any line is unavailable or the
--     cart is empty. Removing/blocking is left to the app layer (this
--     ticket explicitly excludes checkout itself, Epic 7) -- the "cart is
--     not ready" signal built here is what a later checkout ticket must gate
--     on.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists remove_cart_item(uuid, uuid, uuid);
--   drop function if exists update_cart_item_quantity(uuid, uuid, uuid, integer);
--   drop function if exists add_cart_item(uuid, uuid, uuid, uuid, integer, uuid[]);
--   drop function if exists get_cart_view(uuid, uuid);
--   drop function if exists build_cart_view(uuid);
--   drop function if exists get_or_create_cart(uuid, text);
--   drop table if exists cart_item_selections;
--   drop table if exists cart_items;
--   drop table if exists carts;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- SHA-256 hex of the opaque guest cart token -- the raw token never
  -- reaches the database, matching invitations.token_hash's convention.
  cart_token_hash text not null unique check (cart_token_hash ~ '^[a-f0-9]{64}$'),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create trigger carts_set_updated_at
  before update on carts
  for each row
  execute function set_updated_at();

create index carts_tenant_id_idx on carts (tenant_id);

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_id uuid not null references carts (id) on delete cascade,
  dish_id uuid not null references dishes (id) on delete cascade,
  dish_variant_id uuid references dish_variants (id) on delete cascade,
  quantity integer not null check (quantity > 0 and quantity <= 20),
  -- Display-only fallbacks for when a dish/variant is later archived --
  -- never used for pricing (price is always read live; see header note).
  dish_name_snapshot text not null,
  variant_name_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cart_items_set_updated_at
  before update on cart_items
  for each row
  execute function set_updated_at();

create index cart_items_cart_id_idx on cart_items (cart_id);
create index cart_items_tenant_id_idx on cart_items (tenant_id);

create table cart_item_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_item_id uuid not null references cart_items (id) on delete cascade,
  option_group_id uuid not null references option_groups (id) on delete cascade,
  option_id uuid not null references options (id) on delete cascade,
  -- Display-only fallback, same rationale as cart_items' name snapshots.
  option_name_snapshot text not null,
  price_delta_cents_snapshot integer not null,
  created_at timestamptz not null default now(),
  unique (cart_item_id, option_id)
);

create index cart_item_selections_cart_item_id_idx on cart_item_selections (cart_item_id);
create index cart_item_selections_tenant_id_idx on cart_item_selections (tenant_id);

-- Same-tenant integrity guard, mirroring
-- ensure_menu_child_tenant_match()/ensure_assignment_tenant_match() in
-- 20260801110000_restaurant_profile_and_menu_management.sql.
create or replace function ensure_cart_row_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  if tg_table_name = 'cart_items' then
    select tenant_id into v_expected_tenant_id from public.carts where id = new.cart_id;
    if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
      raise exception 'cart_items.tenant_id must match its cart' using errcode = 'check_violation';
    end if;
    if new.dish_id is not null then
      perform 1 from public.dishes where id = new.dish_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'cart_items.dish_id must belong to the same tenant'
          using errcode = 'check_violation';
      end if;
    end if;
    if new.dish_variant_id is not null then
      perform 1 from public.dish_variants where id = new.dish_variant_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'cart_items.dish_variant_id must belong to the same tenant'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'cart_item_selections' then
    select tenant_id into v_expected_tenant_id from public.cart_items where id = new.cart_item_id;
    if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
      raise exception 'cart_item_selections.tenant_id must match its cart item'
        using errcode = 'check_violation';
    end if;
    perform 1 from public.options where id = new.option_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'cart_item_selections.option_id must belong to the same tenant'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger cart_items_tenant_match
  before insert or update on cart_items
  for each row execute function ensure_cart_row_tenant_match();

create trigger cart_item_selections_tenant_match
  before insert or update on cart_item_selections
  for each row execute function ensure_cart_row_tenant_match();

-- ----------------------------------------------------------------------------
-- RLS -- enabled, deliberately with NO policies (see header note): every
-- app-facing role is denied by default; only service_role (bypassrls) can
-- reach these tables, and only through the RPC functions below.
-- ----------------------------------------------------------------------------
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table cart_item_selections enable row level security;

revoke all on carts, cart_items, cart_item_selections from public, anon, authenticated;
grant select, insert, update, delete on carts, cart_items, cart_item_selections to service_role;
revoke truncate on carts, cart_items, cart_item_selections from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_or_create_cart -- resolves (or creates) the cart for a given tenant +
-- hashed guest token. Called once per request from the server-side cart
-- module after it resolves tenant_id from the public route slug.
-- ----------------------------------------------------------------------------
create or replace function get_or_create_cart(p_tenant_id uuid, p_cart_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
begin
  if p_tenant_id is null or p_cart_token_hash is null then
    raise exception 'tenant_id and cart_token_hash are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select id into v_cart_id
    from public.carts
   where tenant_id = p_tenant_id
     and cart_token_hash = p_cart_token_hash;

  if v_cart_id is null then
    insert into public.carts (tenant_id, cart_token_hash)
    values (p_tenant_id, p_cart_token_hash)
    returning id into v_cart_id;
  else
    update public.carts set last_activity_at = now() where id = v_cart_id;
  end if;

  return v_cart_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- build_cart_view -- the authoritative price/availability recalculation.
-- Internal helper (not tenant-checked itself -- callers below always verify
-- ownership first); mirrors packages/domain/src/cart/pricing.ts exactly.
-- ----------------------------------------------------------------------------
create or replace function build_cart_view(p_cart_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with current_pub as (
    select mv.id, mv.tenant_id
      from public.menu_versions mv
      join public.carts c on c.tenant_id = mv.tenant_id
     where c.id = p_cart_id
       and mv.status = 'published'
     order by mv.published_at desc nulls last
     limit 1
  ),
  live_lines as (
    select
      ci.id as cart_item_id,
      ci.dish_id,
      ci.dish_variant_id,
      ci.quantity,
      coalesce(d.name, ci.dish_name_snapshot) as dish_name,
      coalesce(dv.name, ci.variant_name_snapshot) as variant_name,
      coalesce(dv.price_cents, d.price_cents, 0) as unit_price_cents,
      (
        d.id is not null
        and d.archived_at is null
        and d.menu_version_id = (select cp.id from current_pub cp)
        and (ci.dish_variant_id is null or (dv.id is not null and dv.is_available))
      ) as dish_available
    from public.cart_items ci
    left join public.dishes d on d.id = ci.dish_id
    left join public.dish_variants dv on dv.id = ci.dish_variant_id
    where ci.cart_id = p_cart_id
  ),
  line_selections as (
    select
      cis.cart_item_id,
      jsonb_agg(
        jsonb_build_object(
          'optionId', cis.option_id,
          'name', coalesce(o.name, cis.option_name_snapshot),
          'priceDeltaCents', coalesce(o.price_delta_cents, cis.price_delta_cents_snapshot),
          'isAvailable', o.id is not null
        )
        order by coalesce(o.sort_order, 0), coalesce(o.name, cis.option_name_snapshot)
      ) as selections,
      bool_and(o.id is not null) as selections_available,
      sum(coalesce(o.price_delta_cents, cis.price_delta_cents_snapshot)) as selections_total_cents
    from public.cart_item_selections cis
    left join public.options o on o.id = cis.option_id
    where cis.cart_item_id in (select ci.id from public.cart_items ci where ci.cart_id = p_cart_id)
    group by cis.cart_item_id
  ),
  priced_lines as (
    select
      ll.*,
      coalesce(ls.selections, '[]'::jsonb) as selections,
      coalesce(ls.selections_total_cents, 0) as selections_total_cents,
      (ll.dish_available and coalesce(ls.selections_available, true)) as is_available
    from live_lines ll
    left join line_selections ls on ls.cart_item_id = ll.cart_item_id
  )
  select jsonb_build_object(
    'cartId', p_cart_id,
    'currency', (select currency from public.carts where id = p_cart_id),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'cartItemId', pl.cart_item_id,
          'dishId', pl.dish_id,
          'dishName', pl.dish_name,
          'variantId', pl.dish_variant_id,
          'variantName', pl.variant_name,
          'quantity', pl.quantity,
          'unitPriceCents', pl.unit_price_cents,
          'selections', pl.selections,
          'selectionsTotalCents', pl.selections_total_cents,
          'lineTotalCents',
            case when pl.is_available
              then (pl.unit_price_cents + pl.selections_total_cents) * pl.quantity
              else 0
            end,
          'isAvailable', pl.is_available
        )
        order by pl.cart_item_id
      ) filter (where pl.cart_item_id is not null),
      '[]'::jsonb
    ),
    'totalCents', coalesce(sum(
      case when pl.is_available
        then (pl.unit_price_cents + pl.selections_total_cents) * pl.quantity
        else 0
      end
    ), 0),
    'itemCount', count(pl.cart_item_id),
    'hasUnavailableItems', coalesce(bool_or(not pl.is_available), false),
    'checkoutReady', count(pl.cart_item_id) > 0 and coalesce(bool_and(pl.is_available), false)
  )
  from priced_lines pl;
$$;

revoke all on function build_cart_view(uuid) from public;
grant execute on function build_cart_view(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- get_cart_view -- public entry point for reading a cart. Always
-- recalculates from live data (never returns a cached total).
-- ----------------------------------------------------------------------------
create or replace function get_cart_view(p_cart_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.carts where id = p_cart_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Cart not found' using errcode = 'invalid_parameter_value';
  end if;

  update public.carts set last_activity_at = now() where id = p_cart_id;

  return public.build_cart_view(p_cart_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- add_cart_item -- validates the dish/variant/options against the tenant's
-- *currently published* menu (rejecting an already-unavailable product at
-- add-time, acceptance criterion 2), inserts, and returns the freshly
-- recalculated cart.
-- ----------------------------------------------------------------------------
create or replace function add_cart_item(
  p_cart_id uuid,
  p_tenant_id uuid,
  p_dish_id uuid,
  p_dish_variant_id uuid,
  p_quantity integer,
  p_option_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dish public.dishes%rowtype;
  v_variant public.dish_variants%rowtype;
  v_published_version_id uuid;
  v_cart_item_id uuid;
  v_option_id uuid;
  v_group record;
  v_selected_count integer;
begin
  perform 1 from public.carts where id = p_cart_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Cart not found' using errcode = 'invalid_parameter_value';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20' using errcode = 'invalid_parameter_value';
  end if;

  select id into v_published_version_id
    from public.menu_versions
   where tenant_id = p_tenant_id
     and status = 'published'
   order by published_at desc nulls last
   limit 1;

  select * into v_dish
    from public.dishes
   where id = p_dish_id
     and tenant_id = p_tenant_id;

  if v_dish.id is null
     or v_dish.archived_at is not null
     or v_published_version_id is null
     or v_dish.menu_version_id <> v_published_version_id
  then
    raise exception 'This dish is no longer available' using errcode = 'invalid_parameter_value';
  end if;

  if p_dish_variant_id is not null then
    select * into v_variant
      from public.dish_variants
     where id = p_dish_variant_id
       and dish_id = v_dish.id
       and tenant_id = p_tenant_id;

    if v_variant.id is null or not v_variant.is_available then
      raise exception 'This variant is no longer available' using errcode = 'invalid_parameter_value';
    end if;
  elsif exists (select 1 from public.dish_variants where dish_id = v_dish.id) then
    raise exception 'A variant must be selected for this dish'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Validate every requested option belongs to a group assigned to this
  -- dish, and that each group's min/max selection bounds are respected --
  -- never trust the client's own "requiredGroupsSatisfied" check
  -- (apps/web/src/app/r/[slug]/dish-detail.tsx) as authorization.
  foreach v_option_id in array coalesce(p_option_ids, array[]::uuid[])
  loop
    perform 1
      from public.options o
      join public.dish_option_group_assignments doga
        on doga.option_group_id = o.option_group_id and doga.dish_id = v_dish.id
     where o.id = v_option_id
       and o.tenant_id = p_tenant_id;
    if not found then
      raise exception 'Selected option is not available for this dish'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  for v_group in
    select og.id, og.min_selections, og.max_selections
      from public.option_groups og
      join public.dish_option_group_assignments doga on doga.option_group_id = og.id
     where doga.dish_id = v_dish.id
  loop
    select count(*) into v_selected_count
      from public.options o
     where o.option_group_id = v_group.id
       and o.id = any(coalesce(p_option_ids, array[]::uuid[]));

    if v_selected_count < v_group.min_selections or v_selected_count > v_group.max_selections then
      raise exception 'Option selection does not satisfy the required min/max for this dish'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  insert into public.cart_items (
    tenant_id, cart_id, dish_id, dish_variant_id, quantity,
    dish_name_snapshot, variant_name_snapshot
  )
  values (
    p_tenant_id, p_cart_id, v_dish.id, p_dish_variant_id, p_quantity,
    v_dish.name, v_variant.name
  )
  returning id into v_cart_item_id;

  if p_option_ids is not null then
    foreach v_option_id in array p_option_ids
    loop
      insert into public.cart_item_selections (
        tenant_id, cart_item_id, option_group_id, option_id,
        option_name_snapshot, price_delta_cents_snapshot
      )
      select p_tenant_id, v_cart_item_id, o.option_group_id, o.id, o.name, o.price_delta_cents
        from public.options o
       where o.id = v_option_id;
    end loop;
  end if;

  update public.carts set last_activity_at = now() where id = p_cart_id;

  return public.build_cart_view(p_cart_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- update_cart_item_quantity / remove_cart_item
-- ----------------------------------------------------------------------------
create or replace function update_cart_item_quantity(
  p_cart_id uuid,
  p_tenant_id uuid,
  p_cart_item_id uuid,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.carts where id = p_cart_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Cart not found' using errcode = 'invalid_parameter_value';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20' using errcode = 'invalid_parameter_value';
  end if;

  update public.cart_items
     set quantity = p_quantity
   where id = p_cart_item_id
     and cart_id = p_cart_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Cart item not found' using errcode = 'invalid_parameter_value';
  end if;

  update public.carts set last_activity_at = now() where id = p_cart_id;

  return public.build_cart_view(p_cart_id);
end;
$$;

create or replace function remove_cart_item(p_cart_id uuid, p_tenant_id uuid, p_cart_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.carts where id = p_cart_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Cart not found' using errcode = 'invalid_parameter_value';
  end if;

  delete from public.cart_items
   where id = p_cart_item_id
     and cart_id = p_cart_id
     and tenant_id = p_tenant_id;

  update public.carts set last_activity_at = now() where id = p_cart_id;

  return public.build_cart_view(p_cart_id);
end;
$$;

revoke all on function get_or_create_cart(uuid, text) from public;
revoke all on function get_cart_view(uuid, uuid) from public;
revoke all on function add_cart_item(uuid, uuid, uuid, uuid, integer, uuid[]) from public;
revoke all on function update_cart_item_quantity(uuid, uuid, uuid, integer) from public;
revoke all on function remove_cart_item(uuid, uuid, uuid) from public;

-- Intentionally service_role ONLY (no anon, no authenticated) -- see header
-- note. Guests never call these directly; only the Next.js server does, via
-- the service-role client.
grant execute on function get_or_create_cart(uuid, text) to service_role;
grant execute on function get_cart_view(uuid, uuid) to service_role;
grant execute on function add_cart_item(uuid, uuid, uuid, uuid, integer, uuid[]) to service_role;
grant execute on function update_cart_item_quantity(uuid, uuid, uuid, integer) to service_role;
grant execute on function remove_cart_item(uuid, uuid, uuid) to service_role;

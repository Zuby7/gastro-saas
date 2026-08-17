-- ============================================================================
-- Ticket #29 (Epic 8): Ausverkauft-Steuerung on dishes and options, optional
-- scheduled re-availability, a dedicated `menu.availability.manage`
-- permission, and the admin-facing toggle RPCs behind it.
--
-- `dish_variants.is_available` already existed (Epic 4) and already worked
-- end-to-end (public menu query, cart pricing, publish-guard exemption --
-- see 20260803100000_dish_variant_availability_toggle_exemption.sql). This
-- migration extends the same flag to `dishes` (base-priced dishes with no
-- variants had no way to be marked sold out) and to `options` (individual
-- extras), and adds an optional `available_again_at timestamptz` to all
-- three tables for scheduled auto-re-availability.
--
-- `available_again_at` evaluation strategy (explicit decision, no cron/
-- scheduler infra exists in this repo -- see issue #88 for the identical gap
-- on the payments side): there is NO background job that flips
-- `is_available` back to true when the timestamp passes. Instead, every read
-- path that already derives purchasability from `is_available` (the public
-- menu query, cart pricing, and the new admin listing paths) evaluates
-- effective availability inline via `is_menu_item_available()` below:
--   effective_available := is_available OR (available_again_at IS NOT NULL
--                                            AND available_again_at <= now())
-- `is_available` remains the sole source of truth when `available_again_at`
-- is null. A human toggling the item back on (or the schedule lapsing) both
-- read as "available" the next time any of these functions run -- there is
-- no eventual-consistency window beyond normal read latency, and no stored
-- row is ever mutated by the passage of time alone (the `is_available`
-- column itself is left untouched by the grace period; only the *read*
-- layer treats it as available). This is intentionally the simplest correct
-- approach for this ticket's scope; a real scheduler-driven flip-back (which
-- would let e.g. an admin listing's raw `is_available` column reflect
-- "available again" without also checking `available_again_at` itself) is
-- out of scope, same rationale as issue #88.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists set_option_availability(uuid, uuid, boolean, timestamptz);
--   drop function if exists set_dish_variant_availability(uuid, uuid, boolean, timestamptz);
--   drop function if exists set_dish_availability(uuid, uuid, boolean, timestamptz);
--   drop function if exists is_menu_item_available(boolean, timestamptz);
--   alter table options drop column if exists available_again_at;
--   alter table options drop column if exists is_available;
--   alter table dish_variants drop column if exists available_again_at;
--   alter table dishes drop column if exists available_again_at;
--   alter table dishes drop column if exists is_available;
--   (re-apply the previous ensure_menu_version_editable()/get_public_menu()/
--    build_cart_view()/add_cart_item()/clone_menu_version_as_draft() bodies
--    from their prior migrations to fully roll back the function changes.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema: is_available/available_again_at on dishes and options,
-- available_again_at on dish_variants.
-- ----------------------------------------------------------------------------
alter table dishes
  add column is_available boolean not null default true,
  add column available_again_at timestamptz;

alter table dish_variants
  add column available_again_at timestamptz;

alter table options
  add column is_available boolean not null default true,
  add column available_again_at timestamptz;

-- ----------------------------------------------------------------------------
-- Shared "is this menu item purchasable right now" helper -- see the header
-- comment above for the exact evaluation rule. Used by every read path below
-- instead of re-deriving the OR-condition ad hoc (and to keep the one
-- decision documented in a single place).
-- ----------------------------------------------------------------------------
create or replace function is_menu_item_available(p_is_available boolean, p_available_again_at timestamptz)
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
  select coalesce(p_is_available, false)
    or (p_available_again_at is not null and p_available_again_at <= now());
$$;

comment on function is_menu_item_available(boolean, timestamptz) is
  'True if a dishes/dish_variants/options row is purchasable: is_available is true, OR available_again_at is set and has already passed. No cron/background job flips is_available itself -- see 20260817090000_dish_option_availability_and_scheduling.sql header comment.';

-- ----------------------------------------------------------------------------
-- Extend the draft/publish write-guard's is_available-only exemption
-- (20260803100000_dish_variant_availability_toggle_exemption.sql) to also
-- cover: (a) available_again_at alongside is_available on dish_variants, and
-- (b) the same is_available/available_again_at-only exemption on dishes.
--
-- options/option_groups still have no ensure_menu_version_editable trigger
-- at all (they're tenant-scoped, not version-scoped -- see the "Draft/publish
-- write guard" comment in 20260801110000_restaurant_profile_and_menu_management.sql),
-- so options.is_available/available_again_at are already freely toggleable
-- on a published menu version without any change here -- ticket #29's
-- requirement "toggleable on an already-published menu, like dish_variants"
-- is trivially satisfied for options and needs no new exemption code.
-- ----------------------------------------------------------------------------
create or replace function ensure_menu_version_editable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_menu_version_id uuid;
  v_dish_id uuid;
  v_status text;
begin
  -- Nested (not combined into one flat boolean expression): PL/pgSQL plans
  -- each IF condition as its own SQL expression against the record type of
  -- whichever table triggered this invocation. A flat
  -- `tg_table_name = 'dish_variants' and new.is_available ...` fails for
  -- every OTHER table this trigger also serves (categories, dishes, ...)
  -- because their NEW/OLD rows have no is_available column at all -- nesting
  -- the column comparison inside its own `if tg_table_name = 'dish_variants'`
  -- block, mirroring the existing `if tg_table_name in (...) then ... else
  -- ...` split below, defers planning that expression until it actually runs.
  if tg_table_name = 'dish_variants' and tg_op = 'UPDATE' then
    if (new.is_available is distinct from old.is_available
        or new.available_again_at is distinct from old.available_again_at)
       and to_jsonb(new) - 'is_available' - 'available_again_at' - 'updated_at'
           = to_jsonb(old) - 'is_available' - 'available_again_at' - 'updated_at'
    then
      return new;
    end if;
  end if;

  if tg_table_name = 'dishes' and tg_op = 'UPDATE' then
    if (new.is_available is distinct from old.is_available
        or new.available_again_at is distinct from old.available_again_at)
       and to_jsonb(new) - 'is_available' - 'available_again_at' - 'updated_at'
           = to_jsonb(old) - 'is_available' - 'available_again_at' - 'updated_at'
    then
      return new;
    end if;
  end if;

  if tg_table_name in ('categories', 'dishes') then
    v_menu_version_id := coalesce(new.menu_version_id, old.menu_version_id);
    select status into v_status from public.menu_versions where id = v_menu_version_id;
  else
    v_dish_id := coalesce(new.dish_id, old.dish_id);
    select mv.status into v_status
      from public.dishes d
      join public.menu_versions mv on mv.id = d.menu_version_id
     where d.id = v_dish_id;
  end if;

  if v_status is not null and v_status <> 'draft' then
    raise exception '% is read-only once its menu version leaves draft status (current status: %)', tg_table_name, v_status
      using errcode = 'read_only_sql_transaction';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Permission: menu.availability.manage
-- ----------------------------------------------------------------------------
insert into permissions (key, description)
values ('menu.availability.manage', 'Mark dishes, variants, and options sold out / available again')
on conflict (key) do update set description = excluded.description;

-- Owner already gets every permission via seed_standard_roles_for_tenant()'s
-- wildcard grant (`select v_owner_role_id, key from permissions`) and the
-- backfill below mirrors that. Manager/Kitchen/Service are operational roles
-- that need to react to sold-out items during service, same reasoning as
-- orders.read/orders.manage for those roles.
insert into role_permissions (role_id, permission_key)
select r.id, 'menu.availability.manage'
  from roles r
 where r.key in ('owner', 'manager', 'kitchen', 'service')
on conflict do nothing;

-- CI migration-validation follow-up fix: this `create or replace` originally
-- reconstructed the function body from 20260801080000's original VALUES list
-- instead of from 20260808130000_stripe_connect_payment_accounts.sql's
-- version (the actual latest one at the time), silently dropping Manager's
-- `payments.read` grant for every tenant created after this migration. That
-- regressed refunds.integration.test.ts (Manager-role RLS insert into
-- `refunds` relies on the surrounding payments.* grant set behaving as
-- documented). Fixed by carrying `payments.read` forward below alongside
-- `menu.availability.manage`. Same fragility as the pattern already flagged
-- in 20260808130000: each migration that touches this function must
-- reconstruct the FULL accumulated grant set from the actual latest version,
-- not just the ticket's own new permission.
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
    (v_manager_role_id, 'menu.availability.manage'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'menu.availability.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'menu.availability.manage'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- Admin toggle RPCs -- SECURITY DEFINER, permission-gated, column-scoped
-- (only ever writes is_available/available_again_at). Deliberately narrower
-- than a raw table UPDATE grant to menu.availability.manage holders would
-- be: Kitchen/Service hold menu.availability.manage but NOT menu.write, and
-- a raw RLS UPDATE policy keyed only on menu.availability.manage could not
-- be restricted to just these two columns (RLS policies can't diff
-- NEW vs OLD column-by-column the way the write-guard trigger above does).
-- Going through these RPCs instead of direct table grants keeps
-- menu.availability.manage from silently becoming "menu.write" for
-- Kitchen/Service.
-- ----------------------------------------------------------------------------
create or replace function set_dish_availability(
  p_dish_id uuid,
  p_tenant_id uuid,
  p_is_available boolean,
  p_available_again_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  update public.dishes
     set is_available = p_is_available,
         available_again_at = p_available_again_at
   where id = p_dish_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Dish not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function set_dish_variant_availability(
  p_variant_id uuid,
  p_tenant_id uuid,
  p_is_available boolean,
  p_available_again_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  update public.dish_variants
     set is_available = p_is_available,
         available_again_at = p_available_again_at
   where id = p_variant_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Variant not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function set_option_availability(
  p_option_id uuid,
  p_tenant_id uuid,
  p_is_available boolean,
  p_available_again_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  update public.options
     set is_available = p_is_available,
         available_again_at = p_available_again_at
   where id = p_option_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Option not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function set_dish_availability(uuid, uuid, boolean, timestamptz) from public;
revoke all on function set_dish_variant_availability(uuid, uuid, boolean, timestamptz) from public;
revoke all on function set_option_availability(uuid, uuid, boolean, timestamptz) from public;
grant execute on function set_dish_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;
grant execute on function set_dish_variant_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;
grant execute on function set_option_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_public_menu(): soldOut now also accounts for the dish's OWN
-- is_available/available_again_at (regardless of any variant's own
-- availability, per ticket #29 acceptance criteria), and both the returned
-- variants and options arrays are filtered down to effectively-available
-- rows using is_menu_item_available().
-- ----------------------------------------------------------------------------
create or replace function get_public_menu(p_tenant_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_menu_version_id uuid;
  v_result jsonb;
begin
  select t.id, mv.id
    into v_tenant_id, v_menu_version_id
    from public.tenants t
    join public.menu_versions mv on mv.tenant_id = t.id and mv.status = 'published'
   where t.slug = p_tenant_slug
   order by mv.published_at desc nulls last
   limit 1;

  if v_tenant_id is null then
    return null;
  end if;

  -- Opus batch review (epic-3-5-batch, medium, fake-metric inflation):
  -- this function is granted to anon and was writing an analytics_events
  -- row on every call, unbounded and ungated -- anyone could inflate
  -- "menu viewed" counts arbitrarily by hitting the public endpoint in a
  -- loop. Removed outright rather than adding throttling/dedup here, which
  -- would be disproportionate scope for this fix cycle. Real view analytics
  -- need a proper throttled/deduplicated mechanism (e.g. rate-limited per
  -- IP/session, or deduplicated within a time window) -- tracked as a
  -- follow-up, see the GitHub issue referenced in this migration's PR.

  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'slug', t.slug,
      'name', coalesce(rp.display_name, t.name),
      'description', coalesce(rp.description, ''),
      'timezone', coalesce(rp.timezone, 'Europe/Berlin'),
      'brandColor', coalesce(rp.brand_color, '#166534')
    ),
    'categories', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'dishes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', d.id,
              'name', d.name,
              'description', d.description,
              'priceCents', d.price_cents,
              'currency', d.currency,
              -- Ticket #29: a dish is sold out if EITHER its own
              -- is_available/available_again_at says so, OR (same as
              -- ticket #84's original formula) it has no base price and no
              -- effectively-available variant.
              'soldOut', not (
                public.is_menu_item_available(d.is_available, d.available_again_at)
                and (
                  d.price_cents is not null
                  or exists (
                    select 1 from public.dish_variants dv
                     where dv.dish_id = d.id
                       and public.is_menu_item_available(dv.is_available, dv.available_again_at)
                  )
                )
              ),
              'image', case when ma.id is null then null else jsonb_build_object('path', ma.storage_path, 'alt', ma.alt_text) end,
              'variants', coalesce((
                select jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.name, 'priceCents', dv.price_cents, 'currency', dv.currency))
                  from public.dish_variants dv
                 where dv.dish_id = d.id
                   and public.is_menu_item_available(dv.is_available, dv.available_again_at)
              ), '[]'::jsonb),
              'optionGroups', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', og.id,
                  'name', og.name,
                  'minSelections', og.min_selections,
                  'maxSelections', og.max_selections,
                  'options', coalesce((
                    select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'priceDeltaCents', o.price_delta_cents, 'currency', o.currency) order by o.sort_order, o.name)
                      from public.options o
                     where o.option_group_id = og.id
                       and public.is_menu_item_available(o.is_available, o.available_again_at)
                  ), '[]'::jsonb)
                ))
                  from public.dish_option_group_assignments doga
                  join public.option_groups og on og.id = doga.option_group_id
                 where doga.dish_id = d.id
              ), '[]'::jsonb),
              'labels', coalesce((
                select jsonb_agg(dl.name order by dl.name)
                  from public.dish_dietary_label_assignments ddla
                  join public.dietary_labels dl on dl.id = ddla.dietary_label_id
                 where ddla.dish_id = d.id
              ), '[]'::jsonb),
              'allergenNotice', case when d.allergen_reviewed then 'Vom Restaurant angegeben.' else 'Allergenangaben wurden vom Restaurant noch nicht bestätigt.' end
            )
            order by d.name
          )
          from public.dishes d
          left join public.media_assets ma on ma.id = d.media_asset_id
          where d.category_id = c.id
            and d.archived_at is null
        ), '[]'::jsonb)
      )
      order by c.sort_order, c.name
    ) filter (where c.id is not null), '[]'::jsonb)
  )
    into v_result
    from public.tenants t
    left join public.restaurant_profiles rp on rp.tenant_id = t.id
    left join public.categories c on c.tenant_id = t.id and c.menu_version_id = v_menu_version_id and c.archived_at is null
   where t.id = v_tenant_id
   group by t.id, t.slug, t.name, rp.display_name, rp.description, rp.timezone, rp.brand_color;

  return v_result;
end;
$$;

revoke all on function get_public_menu(text) from public;
grant execute on function get_public_menu(text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Cart pricing: build_cart_view()'s live availability derivation and
-- add_cart_item()'s add-time validation both now also account for the
-- dish's own is_available/available_again_at and for option-level
-- availability (previously only variant availability was checked anywhere
-- in the cart path).
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
        and public.is_menu_item_available(d.is_available, d.available_again_at)
        and (
          ci.dish_variant_id is null
          or (dv.id is not null and public.is_menu_item_available(dv.is_available, dv.available_again_at))
        )
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
          'isAvailable', o.id is not null and public.is_menu_item_available(o.is_available, o.available_again_at)
        )
        order by coalesce(o.sort_order, 0), coalesce(o.name, cis.option_name_snapshot)
      ) as selections,
      bool_and(o.id is not null and public.is_menu_item_available(o.is_available, o.available_again_at)) as selections_available,
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
     or not public.is_menu_item_available(v_dish.is_available, v_dish.available_again_at)
  then
    raise exception 'This dish is no longer available' using errcode = 'invalid_parameter_value';
  end if;

  if p_dish_variant_id is not null then
    select * into v_variant
      from public.dish_variants
     where id = p_dish_variant_id
       and dish_id = v_dish.id
       and tenant_id = p_tenant_id;

    if v_variant.id is null or not public.is_menu_item_available(v_variant.is_available, v_variant.available_again_at) then
      raise exception 'This variant is no longer available' using errcode = 'invalid_parameter_value';
    end if;
  elsif exists (select 1 from public.dish_variants where dish_id = v_dish.id) then
    raise exception 'A variant must be selected for this dish'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Validate every requested option belongs to a group assigned to this
  -- dish, and that each group's min/max selection bounds are respected --
  -- never trust the client's own "requiredGroupsSatisfied" check
  -- (apps/web/src/app/r/[slug]/dish-detail.tsx) as authorization. Also
  -- rejects an option that has itself been marked sold out (ticket #29) --
  -- previously only the option's *existence*/assignment was checked here.
  foreach v_option_id in array coalesce(p_option_ids, array[]::uuid[])
  loop
    perform 1
      from public.options o
      join public.dish_option_group_assignments doga
        on doga.option_group_id = o.option_group_id and doga.dish_id = v_dish.id
     where o.id = v_option_id
       and o.tenant_id = p_tenant_id
       and public.is_menu_item_available(o.is_available, o.available_again_at);
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

revoke all on function add_cart_item(uuid, uuid, uuid, uuid, integer, uuid[]) from public;
grant execute on function add_cart_item(uuid, uuid, uuid, uuid, integer, uuid[]) to service_role;

-- ----------------------------------------------------------------------------
-- clone_menu_version_as_draft(): carry over the new availability columns
-- when publishing clones a version's dishes/variants into the next draft --
-- without this, publishing would silently reset every dish/variant back to
-- "available" in the new draft, discarding an in-flight sold-out flag.
-- (options are tenant-scoped, not version-scoped, and are referenced as-is,
-- not cloned -- unaffected by this change.)
-- ----------------------------------------------------------------------------
-- Based on the CTE-rewritten version from
-- 20260816130000_menu_versions_version_number_uniqueness_and_single_draft.sql
-- (ticket #69) -- NOT the older `create temporary table ... on commit drop`
-- version this migration used to (incorrectly) restore. Only change from
-- that version: dish_map/inserted_dishes/inserted_variants now also carry
-- is_available/available_again_at through to the cloned rows (see this
-- section's own header comment above).
create or replace function clone_menu_version_as_draft(p_source_menu_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_version_id uuid;
begin
  with source as (
    select tenant_id
      from public.menu_versions
     where id = p_source_menu_version_id
  ),
  new_version as (
    insert into public.menu_versions (tenant_id, status, version_number)
    select source.tenant_id,
           'draft',
           coalesce(
             (select max(mv.version_number)
                from public.menu_versions mv
               where mv.tenant_id = source.tenant_id),
             0
           ) + 1
      from source
    returning id, tenant_id
  ),
  category_map as (
    select c.id as old_id,
           gen_random_uuid() as new_id,
           c.tenant_id,
           c.name,
           c.sort_order,
           c.archived_at
      from public.categories c
     where c.menu_version_id = p_source_menu_version_id
  ),
  inserted_categories as (
    insert into public.categories (id, tenant_id, menu_version_id, name, sort_order, archived_at)
    select cm.new_id, cm.tenant_id, nv.id, cm.name, cm.sort_order, cm.archived_at
      from category_map cm, new_version nv
    returning id
  ),
  dish_map as (
    select d.id as old_id,
           gen_random_uuid() as new_id,
           d.tenant_id,
           d.category_id,
           d.media_asset_id,
           d.name,
           d.description,
           d.price_cents,
           d.currency,
           d.allergen_reviewed,
           d.archived_at,
           d.is_available,
           d.available_again_at
      from public.dishes d
     where d.menu_version_id = p_source_menu_version_id
  ),
  -- The `where cm.new_id in (select id from inserted_categories)` clause
  -- below is not a data filter (every cm.new_id is, by construction, one of
  -- inserted_categories' returned ids) -- it forces Postgres to actually
  -- execute inserted_categories to completion before this INSERT runs.
  -- Without it, the `dishes_tenant_match` trigger (which SELECTs the parent
  -- category row live from the table) can fire before the category rows it
  -- depends on actually exist, since separate data-modifying CTEs otherwise
  -- have no guaranteed relative execution order.
  inserted_dishes as (
    insert into public.dishes (id, tenant_id, menu_version_id, category_id, media_asset_id, name, description, price_cents, currency, allergen_reviewed, archived_at, is_available, available_again_at)
    select dm.new_id, dm.tenant_id, nv.id, cm.new_id, dm.media_asset_id, dm.name, dm.description, dm.price_cents, dm.currency, dm.allergen_reviewed, dm.archived_at, dm.is_available, dm.available_again_at
      from dish_map dm
      join category_map cm on cm.old_id = dm.category_id
      cross join new_version nv
     where cm.new_id in (select id from inserted_categories)
    returning id
  ),
  -- Same forced-dependency reasoning as inserted_dishes above: every
  -- dish-child insert below depends on `inserted_dishes` having actually
  -- run first, since their tenant-match triggers SELECT the parent dish row
  -- live from the table.
  inserted_variants as (
    insert into public.dish_variants (tenant_id, dish_id, name, price_cents, currency, is_available, available_again_at, sort_order)
    select dv.tenant_id, dm.new_id, dv.name, dv.price_cents, dv.currency, dv.is_available, dv.available_again_at, dv.sort_order
      from public.dish_variants dv
      join dish_map dm on dm.old_id = dv.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  inserted_option_groups as (
    insert into public.dish_option_group_assignments (dish_id, option_group_id, tenant_id, sort_order)
    select dm.new_id, a.option_group_id, a.tenant_id, a.sort_order
      from public.dish_option_group_assignments a
      join dish_map dm on dm.old_id = a.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  inserted_removable_ingredients as (
    insert into public.removable_ingredients (dish_id, ingredient_id, tenant_id)
    select dm.new_id, r.ingredient_id, r.tenant_id
      from public.removable_ingredients r
      join dish_map dm on dm.old_id = r.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  inserted_allergens as (
    insert into public.dish_allergen_assignments (dish_id, allergen_id, tenant_id)
    select dm.new_id, a.allergen_id, a.tenant_id
      from public.dish_allergen_assignments a
      join dish_map dm on dm.old_id = a.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  inserted_additives as (
    insert into public.dish_additive_assignments (dish_id, additive_id, tenant_id)
    select dm.new_id, a.additive_id, a.tenant_id
      from public.dish_additive_assignments a
      join dish_map dm on dm.old_id = a.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  inserted_dietary_labels as (
    insert into public.dish_dietary_label_assignments (dish_id, dietary_label_id, tenant_id)
    select dm.new_id, a.dietary_label_id, a.tenant_id
      from public.dish_dietary_label_assignments a
      join dish_map dm on dm.old_id = a.dish_id
     where dm.new_id in (select id from inserted_dishes)
    returning dish_id
  ),
  -- Forces every inserted_* CTE above to actually execute (see header
  -- comment) by referencing each of their outputs here, even though the
  -- resulting counts themselves are never used for anything.
  combined_counts as (
    select
      (select count(*) from inserted_categories) as category_count,
      (select count(*) from inserted_dishes) as dish_count,
      (select count(*) from inserted_variants) as variant_count,
      (select count(*) from inserted_option_groups) as option_group_count,
      (select count(*) from inserted_removable_ingredients) as removable_ingredient_count,
      (select count(*) from inserted_allergens) as allergen_count,
      (select count(*) from inserted_additives) as additive_count,
      (select count(*) from inserted_dietary_labels) as dietary_label_count
  )
  select nv.id
    into v_new_version_id
    from new_version nv, combined_counts;

  if v_new_version_id is null then
    raise exception 'Source menu version not found' using errcode = 'invalid_parameter_value';
  end if;

  return v_new_version_id;
end;
$$;

-- Deliberately NOT re-granting execute to service_role here: ticket #70
-- (20260816140000_clone_menu_version_as_draft_revoke_service_role_grant.sql)
-- revoked that grant on purpose -- a direct service_role RPC call to this
-- function would bypass publish_menu_version()'s menu.publish check,
-- blocker validation, and audit log. publish_menu_version()'s own internal
-- call is unaffected: SECURITY DEFINER functions run with their OWNER's
-- privileges, and both functions share the same owner, which has implicit
-- execute rights on its own functions regardless of any GRANT.
revoke all on function clone_menu_version_as_draft(uuid) from public;

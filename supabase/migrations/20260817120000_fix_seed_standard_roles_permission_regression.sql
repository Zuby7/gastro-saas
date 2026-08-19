-- ============================================================================
-- Epic 8 Opus batch review fixes for ticket #29's own migration
-- (20260817110000_dish_option_availability_and_scheduling.sql)
-- ============================================================================
-- Finding 1 (CRITICAL, permission regression): that migration's
-- `create or replace function seed_standard_roles_for_tenant()` was
-- reconstructed from an OLDER version of the function (the one carrying
-- `payments.read` forward, per that migration's own "CI migration-validation
-- follow-up fix" comment) instead of from the actual latest version at the
-- time. It silently dropped:
--   - `orders.read` / `orders.manage` for Manager/Kitchen/Service, added by
--     sibling tickets #27/#28
--     (20260817090000_orders_read_permission_and_staff_dashboard.sql,
--     20260817100000_orders_manage_permission_and_status_transitions.sql --
--     both PRs in this same epic, based on `main` independently of this
--     ticket's branch, hence not visible to a plain `git diff` here).
--   - `menu.read`, a residual gap from EVEN EARLIER
--     (20260801120000_public_menu_queries.sql added the permission and
--     backfilled it for tenants existing at that time, but never added it to
--     `seed_standard_roles_for_tenant()` itself -- so every tenant created
--     since then never got it for Manager/Kitchen/Service/Marketing, only
--     Owner via the wildcard grant).
--
-- Since migrations apply in ascending timestamp order regardless of which
-- branch/PR they originated from, and this file (and the original
-- 20260817110000 migration) sort after both #27's and #28's migrations, this
-- file becomes authoritative for what a newly created tenant gets once all
-- three (plus this fix) are on `main`. Also self-contained on THIS branch in
-- isolation (`orders.read`/`orders.manage` are (re-)declared here, idempotent
-- via `on conflict ... do update`) so this migration -- and the tests in this
-- PR -- pass whether or not #27/#28 have merged yet.
--
-- `menu.write`/`tenant.settings.write` have the same kind of "never made it
-- into the function body" gap (see
-- 20260808130000_stripe_connect_payment_accounts.sql's comment, which
-- explicitly scoped fixing them out at the time) -- deliberately NOT
-- addressed here, out of scope for this ticket's fix cycle. Flagged as a
-- residual concern in the PR rather than silently expanding scope.
--
-- Finding 11 (doc typo): `is_menu_item_available()`'s COMMENT pointed at the
-- wrong filename (...090000... instead of ...110000...) -- fixed below.
--
-- Finding 5 (available_again_at validation): `set_dish_availability()`/
-- `set_dish_variant_availability()`/`set_option_availability()` silently
-- accepted `available_again_at <= now()` combined with `is_available =
-- false`, which is a no-op per `is_menu_item_available()`'s own formula (the
-- item reads as available immediately) -- leaving the admin-facing raw
-- `is_available = false` state permanently diverged from what's actually
-- purchasable. All three RPCs now null out `available_again_at` whenever
-- it's already due (`<= now()`), so the stored row and the effective
-- availability it implies can never disagree.
--
-- Finding 6 (soldOut and unsatisfiable required option groups): a dish with
-- a required option group (`min_selections >= 1`) whose every assigned
-- option is sold out rendered as orderable (empty `options` array) and then
-- failed at `add_cart_item()`'s min/max check. `get_public_menu()`'s
-- `soldOut` now also flags this case.
--
-- Rollback for local/throwaway DBs: re-apply the previous bodies of
-- `seed_standard_roles_for_tenant()`, `is_menu_item_available()`,
-- `set_dish_availability()`, `set_dish_variant_availability()`,
-- `set_option_availability()`, and `get_public_menu()` from
-- 20260817110000_dish_option_availability_and_scheduling.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Finding 1: re-declare orders.read/orders.manage idempotently so this
-- migration -- and this branch's own CI -- is correct standalone, whether or
-- not #27/#28's migrations have landed on `main` yet.
-- ----------------------------------------------------------------------------
insert into permissions (key, description)
values
  ('orders.read', 'View the tenant''s orders (staff order dashboard/board)'),
  ('orders.manage', 'Change an order''s preparation status (kitchen/service workflow)')
on conflict (key) do update set description = excluded.description;

-- Backfill for tenants that already exist at migration-apply time (mirrors
-- every prior permission-introducing migration's own pattern) -- covers
-- orders.read/orders.manage (in case #27/#28 haven't landed on this
-- environment yet) and menu.read (the older residual gap).
insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'orders.read'),
      ('manager', 'orders.manage'),
      ('kitchen', 'orders.read'),
      ('kitchen', 'orders.manage'),
      ('service', 'orders.read'),
      ('service', 'orders.manage'),
      ('manager', 'menu.read'),
      ('kitchen', 'menu.read'),
      ('service', 'menu.read'),
      ('marketing', 'menu.read')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Finding 1: seed_standard_roles_for_tenant(), reconstructed from the actual
-- complete accumulated grant set (cross-checked against every
-- permission-granting migration in this repo, not hand-copied forward from
-- one prior version):
--   20260801080000 (base): users.invite/users.manage/menu.publish/
--     orders.cancel/payments.refund/analytics.read/audit.read (Manager),
--     orders.cancel (Kitchen/Service), menu.publish/analytics.read
--     (Marketing).
--   20260808130000: + payments.read (Manager).
--   20260817090000 (#27): + orders.read (Manager/Kitchen/Service).
--   20260817100000 (#28): + orders.manage (Manager/Kitchen/Service).
--   20260817110000 (#29, this ticket): + menu.availability.manage
--     (Manager/Kitchen/Service).
--   This fix: also closes the menu.read gap (Manager/Kitchen/Service/
--     Marketing) per the header comment above.
-- ----------------------------------------------------------------------------
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
    (v_manager_role_id, 'menu.read'),
    (v_manager_role_id, 'menu.availability.manage'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'orders.read'),
    (v_manager_role_id, 'orders.manage'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_kitchen_role_id, 'orders.manage'),
    (v_kitchen_role_id, 'menu.read'),
    (v_kitchen_role_id, 'menu.availability.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_service_role_id, 'orders.manage'),
    (v_service_role_id, 'menu.read'),
    (v_service_role_id, 'menu.availability.manage'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'menu.read'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- Finding 11: fix the wrong filename in this function's own COMMENT (it
-- referenced ...090000... where it should reference the migration that
-- actually introduced it, ...110000...). Function body unchanged.
-- ----------------------------------------------------------------------------
comment on function is_menu_item_available(boolean, timestamptz) is
  'True if a dishes/dish_variants/options row is purchasable: is_available is true, OR available_again_at is set and has already passed. No cron/background job flips is_available itself -- see 20260817110000_dish_option_availability_and_scheduling.sql header comment.';

-- ----------------------------------------------------------------------------
-- Finding 5: reject the "no-op" combination of is_available = false with an
-- available_again_at that has already passed, by nulling out
-- available_again_at whenever it is not null and already due -- otherwise
-- the row would remain purchasable (per is_menu_item_available()'s own OR)
-- while its raw is_available column still (misleadingly) reads false, and
-- the admin UI's badge would show "Ausverkauft" for an item that public
-- customers can already order.
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
declare
  v_available_again_at timestamptz := p_available_again_at;
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  if v_available_again_at is not null and v_available_again_at <= now() then
    v_available_again_at := null;
  end if;

  update public.dishes
     set is_available = p_is_available,
         available_again_at = v_available_again_at
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
declare
  v_available_again_at timestamptz := p_available_again_at;
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  if v_available_again_at is not null and v_available_again_at <= now() then
    v_available_again_at := null;
  end if;

  update public.dish_variants
     set is_available = p_is_available,
         available_again_at = v_available_again_at
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
declare
  v_available_again_at timestamptz := p_available_again_at;
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.availability.manage');

  if v_available_again_at is not null and v_available_again_at <= now() then
    v_available_again_at := null;
  end if;

  update public.options
     set is_available = p_is_available,
         available_again_at = v_available_again_at
   where id = p_option_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Option not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Grants/revokes unchanged from 20260817110000 -- `create or replace`
-- preserves the prior grants, re-stated here only for clarity/idempotency.
revoke all on function set_dish_availability(uuid, uuid, boolean, timestamptz) from public;
revoke all on function set_dish_variant_availability(uuid, uuid, boolean, timestamptz) from public;
revoke all on function set_option_availability(uuid, uuid, boolean, timestamptz) from public;
grant execute on function set_dish_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;
grant execute on function set_dish_variant_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;
grant execute on function set_option_availability(uuid, uuid, boolean, timestamptz) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Finding 6: get_public_menu()'s soldOut now also flags a dish whose
-- required option group (min_selections >= 1) has no effectively-available
-- option left -- previously such a dish rendered as orderable with an empty
-- options array and only failed once a customer actually tried to add it to
-- the cart (add_cart_item()'s own min/max check).
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
              -- effectively-available variant, OR (finding 6, epic-8 batch
              -- review) it has a required option group (min_selections >= 1)
              -- with no effectively-available option left -- such a group
              -- can never be satisfied, so the dish is unorderable even
              -- though it and all its variants are themselves available.
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
                and not exists (
                  select 1
                    from public.dish_option_group_assignments doga
                    join public.option_groups og on og.id = doga.option_group_id
                   where doga.dish_id = d.id
                     and og.min_selections >= 1
                     and not exists (
                       select 1 from public.options o
                        where o.option_group_id = og.id
                          and public.is_menu_item_available(o.is_available, o.available_again_at)
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

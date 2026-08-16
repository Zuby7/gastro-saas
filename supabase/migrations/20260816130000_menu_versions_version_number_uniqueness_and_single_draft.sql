-- ============================================================================
-- Ticket #69 (Opus batch review, epic-3-5-batch, cycle 2 finding):
-- clone_menu_version_as_draft() derived the new draft's version_number from
-- the SOURCE version's version_number + 1, with no unique constraint on
-- (tenant_id, version_number) and no invariant enforcing at most one 'draft'
-- row per tenant. Republishing/cloning from an older (non-latest) version
-- could produce a version_number that collides with an already-existing
-- later version, and nothing stopped a tenant from ending up with two
-- concurrent drafts. Additionally, the function used
-- `create temporary table ... on commit drop` id-mapping tables -- a second
-- clone_menu_version_as_draft() call within the SAME transaction (e.g. two
-- publishes batched together) would fail with a "relation already exists"
-- error, since `on commit drop` only drops the temp table at transaction
-- end, not between statements within it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Opus review finding on PR #104: the two unique indexes below would abort
-- mid-apply on any environment that already has duplicate version_numbers
-- or multiple concurrent drafts for the same tenant -- which is exactly the
-- bug this ticket fixes, so an already-affected environment (any deployed
-- environment that hit the bug before this migration ships) cannot be
-- assumed clean. These two backfill steps deterministically resolve any
-- existing violations before the indexes are created, so the migration
-- applies cleanly regardless of prior data state (and is a no-op if the
-- environment is already clean, e.g. this repo's local/CI stacks).
-- ----------------------------------------------------------------------------

-- 1. Collapse multiple concurrent drafts per tenant down to one: keep the
--    newest (by created_at, tie-broken by id) as the live draft, archive the
--    rest. 'archived' (not a new status) is reused deliberately -- it's the
--    same state a superseded published version already lands in, and this
--    migration runs as a privileged/migration connection (not an app-facing
--    role), so guard_menu_versions_status_change()'s guard trigger does not
--    apply here (see that function's own comment: it only restricts
--    'authenticated'/'anon'/'service_role' callers).
do $$
declare
  v_tenant record;
  v_ids uuid[];
begin
  for v_tenant in
    select tenant_id
      from public.menu_versions
     where status = 'draft'
     group by tenant_id
    having count(*) > 1
  loop
    select array_agg(id order by created_at desc, id desc)
      into v_ids
      from public.menu_versions
     where tenant_id = v_tenant.tenant_id
       and status = 'draft';

    update public.menu_versions
       set status = 'archived'
     where id = any (v_ids[2:array_length(v_ids, 1)]);
  end loop;
end;
$$;

-- 2. Renumber any duplicate (tenant_id, version_number) rows: the earliest
--    (by created_at, tie-broken by id) keeps its existing number; every
--    later duplicate gets bumped to the next free number for that tenant
--    (computed fresh each time so multiple duplicates in the same tenant
--    never collide with each other either).
do $$
declare
  v_dup record;
  v_ids uuid[];
  v_next_number integer;
  i integer;
begin
  for v_dup in
    select tenant_id, version_number
      from public.menu_versions
     group by tenant_id, version_number
    having count(*) > 1
  loop
    select array_agg(id order by created_at, id)
      into v_ids
      from public.menu_versions
     where tenant_id = v_dup.tenant_id
       and version_number = v_dup.version_number;

    for i in 2..array_length(v_ids, 1) loop
      select coalesce(max(version_number), 0) + 1
        into v_next_number
        from public.menu_versions
       where tenant_id = v_dup.tenant_id;

      update public.menu_versions
         set version_number = v_next_number
       where id = v_ids[i];
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Enforce both invariants at the database level (defense in depth -- not
-- just relying on application/RPC logic to derive the right number or avoid
-- creating a second draft):
--
-- 1. (tenant_id, version_number) must be unique: no two menu_versions rows
--    for the same tenant can ever share a version_number, regardless of
--    which code path inserted them.
-- 2. At most one 'draft' menu_versions row per tenant at a time (partial
--    unique index, scoped to status = 'draft' -- published/archived
--    versions are unrestricted). publish_menu_version() already updates the
--    outgoing draft's status to 'published' in the same transaction, before
--    clone_menu_version_as_draft() inserts the new draft row further down,
--    so this does not conflict with the normal publish flow (Postgres
--    unique indexes are checked immediately, not deferred, and both
--    statements run in the same transaction so the UPDATE's effect is
--    already visible when the INSERT's constraint check runs).
-- ----------------------------------------------------------------------------
create unique index if not exists menu_versions_tenant_version_number_key
  on public.menu_versions (tenant_id, version_number);

create unique index if not exists menu_versions_single_draft_per_tenant_key
  on public.menu_versions (tenant_id)
  where status = 'draft';

-- ----------------------------------------------------------------------------
-- Rewrites clone_menu_version_as_draft():
--
-- - `version_number` is now derived from `max(version_number) + 1` across
--   ALL of the tenant's menu_versions rows (same idiom already used by
--   create_initial_draft_menu_version() in 20260802090000_menu_admin_ui_support.sql),
--   not `source.version_number + 1` -- so cloning from any version, not
--   just the current latest, always lands on a fresh, non-colliding number.
-- - Id-mapping is now done via CTEs (`category_map`/`dish_map`, computed
--   once per statement execution and referenced by every dependent INSERT)
--   instead of `create temporary table ... on commit drop` -- no session/
--   transaction-scoped temp table state survives past this one statement,
--   so calling this function twice in the same transaction (e.g. two
--   publishes batched together) no longer hits a temp-table name collision.
-- - `combined_counts` at the end deliberately references every inserted_*
--   CTE (even ones the final SELECT would otherwise have no reason to
--   read) so every data-modifying CTE is guaranteed to actually execute --
--   Postgres does not execute a data-modifying WITH entry unless something
--   in the query (transitively) references its output.
-- ----------------------------------------------------------------------------
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
           d.archived_at
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
    insert into public.dishes (id, tenant_id, menu_version_id, category_id, media_asset_id, name, description, price_cents, currency, allergen_reviewed, archived_at)
    select dm.new_id, dm.tenant_id, nv.id, cm.new_id, dm.media_asset_id, dm.name, dm.description, dm.price_cents, dm.currency, dm.allergen_reviewed, dm.archived_at
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
    insert into public.dish_variants (tenant_id, dish_id, name, price_cents, currency, is_available, sort_order)
    select dv.tenant_id, dm.new_id, dv.name, dv.price_cents, dv.currency, dv.is_available, dv.sort_order
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

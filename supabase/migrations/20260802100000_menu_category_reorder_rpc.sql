-- ============================================================================
-- Epic 4 admin UI, Opus cycle-3 fix (artifacts/reviews/epic-3-5-batch.json,
-- item "moveCategoryAction"): the admin menu editor's Up/Down reorder action
-- was doing three separate non-transactional `.update()` calls from
-- `apps/web`, swapping two categories' `sort_order` via a sentinel `-1`
-- value (to dodge the `(tenant_id, menu_version_id, sort_order)` uniqueness
-- constraint mid-swap), without checking each call's error individually. A
-- failure partway through (e.g. a dropped connection after step 1) could
-- strand a category permanently at `sort_order = -1`.
--
-- `swap_category_sort_order(p_category_id, p_neighbor_id)` moves that whole
-- three-step swap into one `SECURITY DEFINER` SQL function: one PL/pgSQL
-- function body is one transaction, so either all three updates apply or
-- none do. Gated on `menu.write` via `require_tenant_permission`, resolving
-- the tenant from the categories rows themselves (never a client-supplied
-- tenant_id) -- matches the existing hardening pattern used throughout
-- 20260801080000_roles_and_permissions_rbac.sql and
-- 20260802090000_menu_admin_ui_support.sql (search_path = '', schema-
-- qualified references, revoke from public / grant to authenticated +
-- service_role only).
--
-- Rollback: additive-only. Down-migration a maintainer can run by hand
-- against a local/throwaway DB:
--   drop function if exists swap_category_sort_order(uuid, uuid);
-- ============================================================================

create or replace function swap_category_sort_order(p_category_id uuid, p_neighbor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_neighbor_tenant_id uuid;
  v_menu_version_id uuid;
  v_neighbor_menu_version_id uuid;
  v_current_sort integer;
  v_neighbor_sort integer;
begin
  select tenant_id, menu_version_id, sort_order
    into v_tenant_id, v_menu_version_id, v_current_sort
    from public.categories
   where id = p_category_id;

  if v_tenant_id is null then
    raise exception 'Category % not found', p_category_id
      using errcode = 'no_data_found';
  end if;

  perform public.require_tenant_permission(v_tenant_id, 'menu.write');

  select tenant_id, menu_version_id, sort_order
    into v_neighbor_tenant_id, v_neighbor_menu_version_id, v_neighbor_sort
    from public.categories
   where id = p_neighbor_id;

  if v_neighbor_tenant_id is null
     or v_neighbor_tenant_id <> v_tenant_id
     or v_neighbor_menu_version_id <> v_menu_version_id
  then
    raise exception 'Neighbor category % not found in the same tenant/menu version as %', p_neighbor_id, p_category_id
      using errcode = 'no_data_found';
  end if;

  -- Swap via a temporary sentinel offset, same as before, but now inside a
  -- single function body (one transaction) instead of three separate
  -- round-trips from the application -- either every update below applies
  -- or the whole swap rolls back, so a category can never be left stranded
  -- at the sentinel value.
  update public.categories set sort_order = -1 where id = p_category_id;
  update public.categories set sort_order = v_current_sort where id = p_neighbor_id;
  update public.categories set sort_order = v_neighbor_sort where id = p_category_id;
end;
$$;

comment on function swap_category_sort_order(uuid, uuid) is
  'Atomically swaps two sibling categories'' sort_order in one transaction (Opus cycle-3 fix for the previous three-round-trip, non-transactional moveCategoryAction). Gated on menu.write via require_tenant_permission, tenant_id resolved from the categories rows themselves, never from a client-supplied value.';

revoke all on function swap_category_sort_order(uuid, uuid) from public;
grant execute on function swap_category_sort_order(uuid, uuid) to authenticated, service_role;

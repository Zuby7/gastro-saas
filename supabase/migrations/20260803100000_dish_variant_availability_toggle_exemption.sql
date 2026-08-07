-- ============================================================================
-- Exempt pure dish_variants.is_available toggles from the draft/publish
-- write guard (ensure_menu_version_editable(), see
-- 20260801110000_restaurant_profile_and_menu_management.sql).
--
-- That guard intentionally makes a published menu version's content
-- read-only (protects historical order snapshots / prevents silent live-menu
-- tampering). But it has no exemption for the one column a restaurant
-- legitimately needs to change on a *live* published menu at any moment:
-- marking a variant sold out. Ticket #20's cart acceptance criteria
-- ("a product that becomes sold out in the meantime is clearly reported and
-- blocked before checkout") requires this to be possible against a published
-- menu version -- the full staff-facing sold-out UI is Epic 8 ticket #29,
-- but the schema must already allow the underlying UPDATE.
--
-- This exemption is narrowly scoped: only dish_variants UPDATEs where
-- is_available is the *sole* changed column pass through regardless of the
-- owning menu version's status. Any other column change (name, price,
-- dish_id, sort_order) -- i.e. an actual content edit -- still requires
-- draft status, same as before. INSERT/DELETE on dish_variants are
-- untouched by this migration.
--
-- Rollback for local/throwaway DBs:
--   Re-apply 20260801110000_restaurant_profile_and_menu_management.sql's
--   original ensure_menu_version_editable() body (drop the dish_variants
--   is_available-only exemption below).
-- ============================================================================

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
  if tg_table_name = 'dish_variants' and tg_op = 'UPDATE'
     and new.is_available is distinct from old.is_available
     and new.name = old.name
     and new.price_cents = old.price_cents
     and new.currency = old.currency
     and new.dish_id = old.dish_id
     and new.sort_order = old.sort_order
  then
    return new;
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

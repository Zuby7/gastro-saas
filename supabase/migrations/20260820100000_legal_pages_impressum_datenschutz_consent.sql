-- ============================================================================
-- Impressum, Datenschutz & Consent (Epic 5, ticket #41)
-- ============================================================================
-- Adds tenant-maintained free-text Impressum ("legal notice") and
-- Datenschutzerklärung ("privacy policy") fields to the existing
-- `restaurant_profiles` table (same table/RLS pattern as ticket #11's
-- profile fields -- no new tenant-scoped table needed, so no new RLS policy
-- is required: the existing `restaurant_profiles` RLS policies from
-- 20260801110000_restaurant_profile_and_menu_management.sql
-- (`is_tenant_member` for select, `has_tenant_permission(..., 'tenant.settings.write')`
-- for insert/update/delete) already cover these two new columns).
--
-- Text is stored and rendered as plain text (not HTML/markdown-to-HTML): the
-- application renders it through React's default text-node escaping (never
-- `dangerouslySetInnerHTML`), which is the simplest sanitization guarantee
-- against XSS via free-text fields per the ticket's security note -- no new
-- markdown-rendering/sanitization dependency was added for this (see
-- docs/platform/service-register.md's license-policy note: new deps need a
-- license check before adding, and this ticket doesn't need one).
--
-- Public read path: a dedicated, narrow `get_public_legal_page()` function
-- (mirrors `get_public_menu()`'s pattern) -- never a generic
-- `select * from restaurant_profiles` exposed to anon.
--
-- Publish-quality-check: `run_menu_publish_checks()` gains two non-blocking
-- 'warning' rows when either text is empty, per the ticket's acceptance
-- criteria ("nicht zwingend Blocker").
-- ============================================================================

alter table restaurant_profiles
  add column legal_imprint_text text not null default '',
  add column legal_privacy_text text not null default '';

comment on column restaurant_profiles.legal_imprint_text is
  'Tenant-maintained Impressum free text (ticket #41), rendered as plain text only -- never dangerouslySetInnerHTML.';
comment on column restaurant_profiles.legal_privacy_text is
  'Tenant-maintained Datenschutzerklärung free text (ticket #41), rendered as plain text only -- never dangerouslySetInnerHTML.';

-- ----------------------------------------------------------------------------
-- Public read path: dedicated narrow function, not a generic select.
-- Returns null if the tenant/slug doesn't exist, so the caller can 404 --
-- matches get_public_menu()'s contract. Unlike get_public_menu(), this does
-- not require a published menu version: the legal pages are tenant-level,
-- not menu-version-scoped, and must be reachable even before a tenant has
-- published its first menu.
-- ----------------------------------------------------------------------------
create or replace function get_public_legal_page(p_tenant_slug text, p_page text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_page not in ('imprint', 'privacy') then
    raise exception 'Unknown legal page: %', p_page using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
    'tenantName', coalesce(rp.display_name, t.name),
    'text', case
      when p_page = 'imprint' then coalesce(rp.legal_imprint_text, '')
      else coalesce(rp.legal_privacy_text, '')
    end
  )
    into v_result
    from public.tenants t
    left join public.restaurant_profiles rp on rp.tenant_id = t.id
   where t.slug = p_tenant_slug;

  return v_result;
end;
$$;

revoke all on function get_public_legal_page(text, text) from public;
grant execute on function get_public_legal_page(text, text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Publish-quality-check warnings for missing Impressum/Datenschutz text.
-- Joins restaurant_profiles by the menu version's tenant -- these warnings
-- are tenant-level, not menu-version-scoped, but run_menu_publish_checks()
-- already writes/returns per-menu_version_id rows, so they're attached to
-- the version being checked like the existing 'allergen-review-missing'
-- warning.
-- ----------------------------------------------------------------------------
create or replace function run_menu_publish_checks(p_menu_version_id uuid)
returns table (severity text, code text, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from public.menu_versions where id = p_menu_version_id;
  if v_tenant_id is null then
    raise exception 'Menu version not found' using errcode = 'invalid_parameter_value';
  end if;

  perform public.require_tenant_permission(v_tenant_id, 'menu.write');

  delete from public.menu_publish_checks where menu_version_id = p_menu_version_id;

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'no-purchasable-dish', 'At least one dish needs a price or purchasable variant.'
  where not exists (
    select 1 from public.dishes d
     where d.menu_version_id = p_menu_version_id
       and d.archived_at is null
       and (d.price_cents is not null or exists (select 1 from public.dish_variants dv where dv.dish_id = d.id and dv.is_available))
  );

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'dish-without-price', d.name || ' has no price or purchasable variant.'
    from public.dishes d
   where d.menu_version_id = p_menu_version_id
     and d.archived_at is null
     and d.price_cents is null
     and not exists (select 1 from public.dish_variants dv where dv.dish_id = d.id and dv.is_available);

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'option-group-empty', og.name || ' has no options.'
    from public.option_groups og
   where og.tenant_id = v_tenant_id
     and exists (
       select 1
         from public.dish_option_group_assignments doga
         join public.dishes d on d.id = doga.dish_id
        where d.menu_version_id = p_menu_version_id
          and doga.option_group_id = og.id
     )
     and not exists (select 1 from public.options o where o.option_group_id = og.id);

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'warning', 'allergen-review-missing', d.name || ' has no restaurant-provided allergen review.'
    from public.dishes d
   where d.menu_version_id = p_menu_version_id
     and d.archived_at is null
     and d.allergen_reviewed = false;

  -- Ticket #41: fehlender Impressum-/Datenschutztext ist eine Warnung, kein
  -- Blocker -- die Speisekarte darf trotzdem veröffentlicht werden.
  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'warning', 'imprint-text-missing', 'Impressum-Text fehlt.'
   where not exists (
     select 1 from public.restaurant_profiles rp
      where rp.tenant_id = v_tenant_id
        and char_length(trim(rp.legal_imprint_text)) > 0
   );

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'warning', 'privacy-text-missing', 'Datenschutztext fehlt.'
   where not exists (
     select 1 from public.restaurant_profiles rp
      where rp.tenant_id = v_tenant_id
        and char_length(trim(rp.legal_privacy_text)) > 0
   );

  return query
  select mpc.severity, mpc.code, mpc.message
    from public.menu_publish_checks mpc
   where mpc.menu_version_id = p_menu_version_id
   order by mpc.severity, mpc.code;
end;
$$;

-- ============================================================================
-- AGB / Widerrufsrecht (Ticket #146: Rechtliche Grundabsicherung)
-- ============================================================================
-- Extends the tenant-maintained free-text legal pages introduced in
-- 20260820100000_legal_pages_impressum_datenschutz_consent.sql (ticket #41)
-- with a third page type: AGB (terms & conditions), including the tenant's
-- own Widerrufsrecht/Rückerstattungsrichtlinie text for orders placed
-- through checkout. Same column/RLS pattern as `legal_imprint_text` /
-- `legal_privacy_text` -- a plain-text column on the existing
-- `restaurant_profiles` table, covered by that table's existing RLS
-- policies (`is_tenant_member` for select,
-- `has_tenant_permission(..., 'tenant.settings.write')` for
-- insert/update/delete), so no new RLS policy is required here.
--
-- As with the other two legal-text columns, this is a tenant-editable
-- placeholder field, not Claude-authored legally-binding AGB text (see
-- CLAUDE.md: "Claiming legal compliance without qualification" is
-- forbidden, and this ticket's explicit non-goal is "keine echten
-- AGB-Texte"). Rendered as plain text only (never
-- `dangerouslySetInnerHTML`), same XSS-safety rationale as the other two
-- legal pages.
-- ============================================================================

alter table restaurant_profiles
  add column legal_terms_text text not null default '';

comment on column restaurant_profiles.legal_terms_text is
  'Tenant-maintained AGB/Widerrufsrecht free text (ticket #146), rendered as plain text only -- never dangerouslySetInnerHTML, same pattern as legal_imprint_text/legal_privacy_text (ticket #41).';

-- ----------------------------------------------------------------------------
-- Public read path: extend the existing narrow function with the new page
-- kind. Signature is unchanged, so the previous `revoke`/`grant` from
-- ticket #41 still applies, but both are re-issued here for
-- self-documentation and to be robust against any future signature change.
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
  if p_page not in ('imprint', 'privacy', 'terms') then
    raise exception 'Unknown legal page: %', p_page using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
    'tenantName', coalesce(rp.display_name, t.name),
    'text', case
      when p_page = 'imprint' then coalesce(rp.legal_imprint_text, '')
      when p_page = 'privacy' then coalesce(rp.legal_privacy_text, '')
      else coalesce(rp.legal_terms_text, '')
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
-- Publish-quality-check warning for missing AGB text -- same non-blocking
-- 'warning' severity as the existing imprint-text-missing/
-- privacy-text-missing checks (ticket #41): the menu may still be published
-- without it, but the owner is nudged to fill it in. Full function body is
-- reproduced (CREATE OR REPLACE replaces the whole function) with only the
-- new block added at the end.
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

  -- Ticket #146: same non-blocking treatment for the new AGB/Widerruf text.
  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'warning', 'terms-text-missing', 'AGB-Text fehlt.'
   where not exists (
     select 1 from public.restaurant_profiles rp
      where rp.tenant_id = v_tenant_id
        and char_length(trim(rp.legal_terms_text)) > 0
   );

  return query
  select mpc.severity, mpc.code, mpc.message
    from public.menu_publish_checks mpc
   where mpc.menu_version_id = p_menu_version_id
   order by mpc.severity, mpc.code;
end;
$$;

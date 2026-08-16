-- ============================================================================
-- Ticket #84: get_public_menu() hardcoded 'soldOut', false for every dish
-- instead of deriving it from the dish's purchasability -- the frontend's
-- already-shipped, correctly-tested sold-out UI (grayed-out image,
-- "Ausverkauft" badge, no price/cart button) never triggered, regardless of
-- whether a dish's variants were actually marked unavailable.
--
-- Uses the exact same "is this dish purchasable" formula already
-- established by run_menu_publish_checks()'s 'no-purchasable-dish' blocker
-- (20260801110000_restaurant_profile_and_menu_management.sql): a dish is
-- purchasable if it has its own price_cents (no variants needed) OR has at
-- least one available variant. soldOut is the negation of that.
-- ============================================================================
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
              -- Ticket #84: soldOut is true when the dish is NOT purchasable
              -- -- no base price of its own AND no available variant --
              -- same formula as run_menu_publish_checks()'s
              -- 'no-purchasable-dish' blocker.
              'soldOut', not (
                d.price_cents is not null
                or exists (select 1 from public.dish_variants dv where dv.dish_id = d.id and dv.is_available)
              ),
              'image', case when ma.id is null then null else jsonb_build_object('path', ma.storage_path, 'alt', ma.alt_text) end,
              'variants', coalesce((
                select jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.name, 'priceCents', dv.price_cents, 'currency', dv.currency))
                  from public.dish_variants dv
                 where dv.dish_id = d.id and dv.is_available
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

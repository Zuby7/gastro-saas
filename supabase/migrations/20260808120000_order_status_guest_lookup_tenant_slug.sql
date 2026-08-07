-- ============================================================================
-- Guest order-status lookup: return owning tenant's slug (Epic 6 batch
-- review, ticket #22 finding 3)
-- ============================================================================
-- `get_order_status_by_token()` (see
-- 20260805090000_order_status_guest_lookup.sql) previously resolved the
-- order purely from the token hash and never returned anything identifying
-- which tenant the order belongs to. That is not a cross-tenant *data* leak
-- -- the caller already holds the valid token, which is the actual
-- authorization boundary -- but it meant the guest-facing page at
-- `/r/[slug]/orders/[token]` never checked that the resolved order actually
-- belongs to the tenant identified by the route's `[slug]` segment, so
-- visiting a restaurant-B URL with a restaurant-A token would silently
-- render restaurant A's order under restaurant B's page chrome/branding.
--
-- Fix: return the owning tenant's `slug` (never `tenant_id`, which stays
-- internal) alongside the existing customer-safe projection, so the page
-- can compare it against the route's `[slug]` param and render the exact
-- same generic "not found" state on a mismatch as it would for an
-- actually-invalid token -- no distinguishable response, so this cannot be
-- used to probe whether a token is valid for some *other* tenant.
--
-- Rollback for local/throwaway DBs: reapply
-- 20260805090000_order_status_guest_lookup.sql's `create or replace
-- function` body (drops the `tenantSlug` key from the returned jsonb).
-- ============================================================================

create or replace function get_order_status_by_token(p_guest_access_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_order record;
  v_tenant_slug text;
  v_items jsonb;
  v_status_history jsonb;
begin
  if p_guest_access_token_hash is null or p_guest_access_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;

  select o.id, o.tenant_id, o.status, o.fulfillment_type, o.table_identifier, o.customer_name,
         o.customer_note, o.total_cents, o.currency, o.created_at, o.updated_at
    into v_order
    from public.orders o
   where o.guest_access_token_hash = p_guest_access_token_hash;

  if not found then
    return null;
  end if;

  select t.slug
    into v_tenant_slug
    from public.tenants t
   where t.id = v_order.tenant_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'dishName', oi.dish_name_snapshot,
             'variantName', oi.variant_name_snapshot,
             'quantity', oi.quantity,
             'unitPriceCents', oi.unit_price_cents_snapshot,
             'selections', (
               select coalesce(jsonb_agg(
                        jsonb_build_object(
                          'name', ois.option_name_snapshot,
                          'priceDeltaCents', ois.price_delta_cents_snapshot
                        )
                        order by ois.created_at
                      ), '[]'::jsonb)
                 from public.order_item_selections ois
                where ois.order_item_id = oi.id
             )
           )
           order by oi.created_at
         ), '[]'::jsonb)
    into v_items
    from public.order_items oi
   where oi.order_id = v_order.id;

  -- Deliberately excludes `note`/`actor_user_id` -- see migration header.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'status', ose.to_status,
             'occurredAt', ose.created_at
           )
           order by ose.created_at
         ), '[]'::jsonb)
    into v_status_history
    from public.order_status_events ose
   where ose.order_id = v_order.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'tenantSlug', v_tenant_slug,
    'status', v_order.status,
    'fulfillmentType', v_order.fulfillment_type,
    'tableIdentifier', v_order.table_identifier,
    'customerName', v_order.customer_name,
    'customerNote', v_order.customer_note,
    'totalCents', v_order.total_cents,
    'currency', v_order.currency,
    'createdAt', v_order.created_at,
    'updatedAt', v_order.updated_at,
    'items', v_items,
    'statusHistory', v_status_history
  );
end;
$$;

comment on function get_order_status_by_token(text) is
  'Sole read path for the public, token-based guest order-status page (ticket #22). Resolves the order exclusively from the guest access token hash (never a client-supplied order/tenant id) and returns only a customer-safe projection, including the owning tenant''s slug (never tenant_id) so callers can verify the order matches the route''s [slug] segment -- see migration header for the full list of deliberately excluded internal/staff-only fields. Returns null (never a distinguishable error) for a wrong/guessed token.';

revoke all on function get_order_status_by_token(text) from public;
grant execute on function get_order_status_by_token(text) to service_role;

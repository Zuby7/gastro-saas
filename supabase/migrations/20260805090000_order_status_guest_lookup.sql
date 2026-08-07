-- ============================================================================
-- Guest order-status lookup (Epic 6, ticket #22)
-- ============================================================================
-- Adds `get_order_status_by_token()` -- the sole read path for the public,
-- token-based order-status page. No new tables/columns: `orders` already
-- carries `guest_access_token_hash` (see the header comment in
-- 20260804090000_orders_state_machine_and_checkout.sql, which reserved this
-- exact column for this ticket). `orders`/`order_items`/
-- `order_item_selections`/`order_status_events` already have RLS enabled
-- with NO policies at all (deny-by-default for `anon`/`authenticated`) and
-- grant only `service_role` -- this migration adds no new GRANTs on those
-- tables, only a new SECURITY DEFINER function, mirroring
-- `create_order_from_cart()`'s precedent exactly.
--
-- Tenant/order resolution: `tenant_id` and `order_id` are both resolved
-- *from the token hash itself* -- never from a client-supplied id (see
-- docs/security/tenant-isolation.md Layer 0). A wrong/guessed token yields
-- exactly the same "not found" (sql null) response as any other lookup
-- miss -- no distinguishable error, no information about whether an order
-- with that token exists (acceptance criterion 1). Per this ticket's
-- guidance, Postgres' own unique-index hash lookup on
-- `orders_guest_access_token_hash_key` is already constant enough for this
-- threat model -- no manual constant-time comparison is added.
--
-- Customer-safe projection only (acceptance criterion 2, "interne
-- Notizen/Mitarbeiterinformationen werden nie angezeigt"): this function
-- deliberately never returns `orders.tenant_id`, `orders.cart_id`,
-- `orders.guest_access_token_hash`, `order_items.dish_id`/`dish_variant_id`
-- (internal foreign keys, not customer-facing), or -- most importantly --
-- `order_status_events.note`/`order_status_events.actor_user_id`. The
-- `note` column is free-text staff/system commentary attached to a status
-- transition (e.g. a future kitchen-side "customer asked for extra
-- napkins" or "delayed, oven issue" note, Epic 8) and `actor_user_id`
-- identifies the staff member who made the change -- both are exactly the
-- "internal notes/staff information" this ticket's acceptance criterion 2
-- forbids showing a guest. There is no other staff-only field on
-- `orders`/`order_items`/`order_item_selections` today, so no further
-- column needs excluding beyond what's listed here.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists get_order_status_by_token(text);
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
  v_items jsonb;
  v_status_history jsonb;
begin
  if p_guest_access_token_hash is null or p_guest_access_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;

  select o.id, o.status, o.fulfillment_type, o.table_identifier, o.customer_name,
         o.customer_note, o.total_cents, o.currency, o.created_at, o.updated_at
    into v_order
    from public.orders o
   where o.guest_access_token_hash = p_guest_access_token_hash;

  if not found then
    return null;
  end if;

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
  'Sole read path for the public, token-based guest order-status page (ticket #22). Resolves the order exclusively from the guest access token hash (never a client-supplied order/tenant id) and returns only a customer-safe projection -- see migration header for the full list of deliberately excluded internal/staff-only fields. Returns null (never a distinguishable error) for a wrong/guessed token.';

revoke all on function get_order_status_by_token(text) from public;
grant execute on function get_order_status_by_token(text) to service_role;

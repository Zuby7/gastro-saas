-- ============================================================================
-- Verified post-order ratings (Epic 10, ticket #33)
-- ============================================================================
-- Adds `ratings` -- one row per *completed* order, submitted by the guest
-- purely through possession of that order's existing guest access token
-- (the same token minted at checkout for ticket #21/#22, see
-- `apps/web/src/lib/orders/token.ts`; no separate "rating token" is minted --
-- it is the exact same single-purpose capability token that already gates
-- reading this order's status, so reusing it here does not create a second,
-- differently-shaped authorization surface for the same order, per
-- `.claude/rules/tenant-isolation.md` Layer 0).
--
-- `submit_order_rating()` is the sole write path: `tenant_id`/`order_id` are
-- resolved *from the token hash itself*, exactly like
-- `get_order_status_by_token()` -- never from a client-supplied id. A
-- wrong/guessed token, an order that isn't `completed` yet, and an order
-- that already has a rating are all rejected (acceptance criteria 1 + 2).
--
-- Non-goal (explicit, ticket #33's Umfang): no admin/moderation read
-- surface here -- that is ticket #34. `ratings` therefore ships with RLS
-- enabled and NO policies at all (deny-by-default for every app-facing
-- role, service_role only), mirroring `orders`/`order_status_events`'
-- precedent exactly; ticket #34 will add whatever `reviews.read`-gated
-- policy/RPC it needs in its own migration rather than this one guessing at
-- its shape.
--
-- Rollback for local/throwaway DBs:
--   revoke execute on function submit_order_rating(text, integer, text) from service_role;
--   drop function if exists submit_order_rating(text, integer, text);
--   drop function if exists get_tenant_rating_summary(uuid);
--   drop table if exists ratings;
--   alter table auth_rate_limit_attempts drop constraint if exists auth_rate_limit_attempts_scope_check;
--   alter table auth_rate_limit_attempts
--     add constraint auth_rate_limit_attempts_scope_check check (scope in ('login', 'register', 'checkout', 'invite'));
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Rate-limit scope: reuse the existing atomic (ip)/(ip, identity) auth
-- rate-limiter (`apps/web/src/lib/auth/rate-limit.ts`) rather than inventing
-- a second abuse-protection mechanism, mirroring checkout's precedent
-- exactly (see 20260804090000_orders_state_machine_and_checkout.sql's
-- identical widening of this same constraint).
-- ----------------------------------------------------------------------------
alter table auth_rate_limit_attempts drop constraint if exists auth_rate_limit_attempts_scope_check;
alter table auth_rate_limit_attempts
  add constraint auth_rate_limit_attempts_scope_check check (scope in ('login', 'register', 'checkout', 'invite', 'rating'));

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------
create table ratings (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade`: unlike orders (immutable financial history, `on
  -- delete restrict`), a rating is a lightweight opinion attached to an
  -- order -- if the order itself is ever hard-deleted (not something any
  -- current ticket does, but nothing here should block it), the rating goes
  -- with it.
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  -- Acceptance criterion 2: "Eine Bestellung kann nur einmal bewertet
  -- werden" -- enforced here (belt), and re-checked explicitly inside
  -- submit_order_rating() before the insert (suspenders), which turns the
  -- resulting unique_violation into a clear, expected, translatable error
  -- rather than a raw constraint-violation leaking to the guest.
  constraint ratings_order_id_key unique (order_id)
);

create index ratings_tenant_id_idx on ratings (tenant_id);

comment on table ratings is
  'One row per completed order, submitted by the guest via submit_order_rating() using that order''s existing guest access token. No import of external-platform reviews (explicit non-goal, ticket #33). No admin/moderation read surface yet (ticket #34).';

-- ----------------------------------------------------------------------------
-- Same-tenant integrity guard, mirroring ensure_order_row_tenant_match()'s
-- precedent for order_items/order_item_selections -- defense-in-depth on top
-- of submit_order_rating() already resolving tenant_id/order_id together
-- from the same order row (so a mismatch can only happen if some future
-- caller bypasses that function directly against the table as service_role).
-- ----------------------------------------------------------------------------
create or replace function ensure_rating_row_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  select tenant_id into v_expected_tenant_id from public.orders where id = new.order_id;
  if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
    raise exception 'ratings.tenant_id must match its order' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger ratings_ensure_tenant_match
  before insert or update on ratings
  for each row
  execute function ensure_rating_row_tenant_match();

-- ----------------------------------------------------------------------------
-- RLS -- enabled, deliberately with NO policies (see migration header):
-- every app-facing role is denied by default; only service_role can reach
-- this table, and only through submit_order_rating() (and, for ticket #34,
-- whatever future reviews.read-gated read path that ticket adds).
-- ----------------------------------------------------------------------------
alter table ratings enable row level security;

revoke all on ratings from public, anon, authenticated;

-- No update/delete grant -- a submitted rating is immutable (no edit/retract
-- flow in this ticket's Umfang).
grant select, insert on ratings to service_role;

revoke truncate on ratings from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- submit_order_rating -- the sole write path. Resolves tenant_id/order_id
-- purely from the guest access token hash (never a client-supplied id),
-- requires the order to already be `completed`, and rejects a second rating
-- for the same order with a clear, translatable error.
-- ----------------------------------------------------------------------------
create or replace function submit_order_rating(
  p_guest_access_token_hash text,
  p_stars integer,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_comment text;
  v_rating_id uuid;
  v_created_at timestamptz;
begin
  if p_guest_access_token_hash is null or p_guest_access_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Order not found' using errcode = 'invalid_parameter_value';
  end if;

  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Stars must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;

  v_comment := coalesce(btrim(p_comment), '');
  if char_length(v_comment) > 1000 then
    raise exception 'Comment is too long' using errcode = 'invalid_parameter_value';
  end if;

  -- Same lookup shape as get_order_status_by_token(): a wrong/guessed token
  -- yields the exact same generic error as any other rejection below -- no
  -- distinguishable response revealing whether a matching order exists.
  select o.id, o.tenant_id, o.status
    into v_order
    from public.orders o
   where o.guest_access_token_hash = p_guest_access_token_hash;

  if not found then
    raise exception 'Order not found' using errcode = 'invalid_parameter_value';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Order is not yet completed' using errcode = 'invalid_parameter_value';
  end if;

  begin
    insert into public.ratings (tenant_id, order_id, stars, comment)
    values (v_order.tenant_id, v_order.id, p_stars, v_comment)
    returning id, created_at into v_rating_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'This order has already been rated' using errcode = 'unique_violation';
  end;

  return jsonb_build_object(
    'ratingId', v_rating_id,
    'stars', p_stars,
    'comment', v_comment,
    'createdAt', v_created_at
  );
end;
$$;

comment on function submit_order_rating(text, integer, text) is
  'Sole write path for guest ratings (ticket #33). Resolves tenant_id/order_id exclusively from the guest access token hash (never a client-supplied id), requires the order to already be completed, and rejects a second rating for the same order.';

revoke all on function submit_order_rating(text, integer, text) from public;
grant execute on function submit_order_rating(text, integer, text) to service_role;

-- ----------------------------------------------------------------------------
-- get_tenant_rating_summary -- read-only aggregate (count + average stars)
-- for a tenant. Not exposed through any admin UI yet (ticket #34's Umfang),
-- but needed now to satisfy acceptance criterion 3 ("Aggregierte Bewertung
-- aktualisiert sich korrekt") with a real, reusable computation rather than
-- an ad-hoc query duplicated by every future caller.
-- ----------------------------------------------------------------------------
create or replace function get_tenant_rating_summary(p_tenant_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'ratingCount', count(*),
    'averageStars', coalesce(round(avg(stars)::numeric, 2), 0)
  )
  from public.ratings
  where tenant_id = p_tenant_id;
$$;

comment on function get_tenant_rating_summary(uuid) is
  'Read-only rating count/average for a tenant (ticket #33). service_role only -- no admin UI wired up yet (ticket #34).';

revoke all on function get_tenant_rating_summary(uuid) from public;
grant execute on function get_tenant_rating_summary(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- get_order_status_by_token: extended (CREATE OR REPLACE, same signature) to
-- additionally project this order's own rating, if any -- so the guest
-- order-status page (ticket #22) can decide whether to show the rating form
-- or an "already rated, thank you" state without a second round-trip/token
-- re-validation. Deliberately still only this order's own rating (never
-- other guests' ratings/any tenant-wide aggregate) -- same customer-safe
-- projection boundary as the rest of this function.
-- ----------------------------------------------------------------------------
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
  v_rating jsonb;
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

  select jsonb_build_object('stars', r.stars, 'comment', r.comment, 'createdAt', r.created_at)
    into v_rating
    from public.ratings r
   where r.order_id = v_order.id;

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
    'statusHistory', v_status_history,
    'rating', v_rating
  );
end;
$$;

comment on function get_order_status_by_token(text) is
  'Sole read path for the public, token-based guest order-status page (ticket #22). Resolves the order exclusively from the guest access token hash (never a client-supplied order/tenant id) and returns only a customer-safe projection, including the owning tenant''s slug (never tenant_id) so callers can verify the order matches the route''s [slug] segment -- see migration header for the full list of deliberately excluded internal/staff-only fields. Returns null (never a distinguishable error) for a wrong/guessed token. Extended by ticket #33 to also include this order''s own rating (null if not yet rated).';

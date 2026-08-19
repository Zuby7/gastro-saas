-- ============================================================================
-- Rating moderation queue (Epic 10, ticket #34)
-- ============================================================================
-- Adds `rating_moderation` (one row per `ratings` row, ticket #33), the
-- `reviews.read`/`reviews.moderate` permissions, and the sole staff write
-- path (`moderate_rating()`) that lets a manager release or hide a guest
-- rating before it is shown anywhere public.
--
-- Picking up exactly where ticket #33 left off (see its migration header,
-- 20260819090000_ratings_guest_submission.sql): `ratings` shipped with RLS
-- enabled and NO policies for any app-facing role -- this migration adds the
-- `reviews.read`-gated SELECT policy it explicitly deferred, rather than
-- guessing at that shape itself.
--
-- Permission scoping: Owner gets both automatically (full permission
-- catalog). Manager gets both `reviews.read`/`reviews.moderate` -- quality
-- control is an operational-management concern, same tier as
-- `payments.refund`/`users.manage`. Kitchen/Service/Marketing get neither --
-- none of those roles has a reason to see or moderate guest feedback.
--
-- "Configurable initial status" (acceptance criterion 1): a new
-- `restaurant_profiles.default_rating_moderation_status` column (default
-- 'pending', i.e. every new rating requires review before ticket #34 exists
-- exposes any public display of ratings). `create_rating_moderation_row()`
-- (an AFTER INSERT trigger on `ratings`, mirroring `ratings`' own
-- `ensure_rating_row_tenant_match()` trigger precedent) reads that column at
-- insert time so a tenant that wants to auto-release ratings can flip the
-- column without any application code change. No settings UI is added for
-- it in this ticket -- the ticket's own Umfang only asks for the moderation
-- table and admin list, not a settings screen; the column is what makes it
-- *configurable*, not what surfaces the control in a UI.
--
-- Two enforcement layers, per this repo's standard (transition_order_status()
-- precedent, 20260817100000_orders_manage_permission_and_status_transitions.sql):
-- the caller (`apps/web/src/app/account/reviews/actions.ts`) must already
-- have called `requireTenantPermission(..., 'reviews.moderate')` before
-- invoking `moderate_rating()`, AND that RPC independently re-checks the same
-- permission itself. Reads go through a `reviews.read`-gated RLS policy on
-- both `ratings` and `rating_moderation` (checked again server-side by the
-- caller before querying), plus a narrow `list_tenant_ratings_for_moderation()`
-- projection RPC with its own explicit re-check, for the admin list's single
-- round-trip join.
--
-- Observability (ticket's own "Moderationsentscheidungen auditiert" note):
-- `audit_rating_moderation_change()`, an AFTER UPDATE trigger on
-- `rating_moderation` that only fires when `status` actually changes,
-- appends an `audit_logs` row -- mirrors `audit_rbac_change()`'s precedent
-- (20260801080000_roles_and_permissions_rbac.sql) of auditing via a trigger
-- rather than relying on every future write path remembering to call an
-- audit helper from application code.
--
-- Residual, explicitly out of this ticket's scope: `get_tenant_rating_summary()`
-- (ticket #33) still aggregates every rating regardless of moderation status
-- -- fine today since that function isn't exposed through any public/admin
-- surface yet (per its own comment), but whichever future ticket exposes a
-- public aggregate/rating list must filter to `status = 'released'` there.
-- Not fixed here to avoid scope creep into a function this ticket doesn't
-- otherwise touch.
--
-- Rollback for local/throwaway DBs:
--   drop trigger if exists rating_moderation_audit_status_change on rating_moderation;
--   drop function if exists audit_rating_moderation_change();
--   revoke all on function moderate_rating(uuid, uuid, text) from authenticated, service_role;
--   drop function if exists moderate_rating(uuid, uuid, text);
--   revoke all on function list_tenant_ratings_for_moderation(uuid) from authenticated, service_role;
--   drop function if exists list_tenant_ratings_for_moderation(uuid);
--   drop policy if exists rating_moderation_select_reviews_read on rating_moderation;
--   drop policy if exists ratings_select_reviews_read on ratings;
--   drop trigger if exists ratings_create_moderation_row on ratings;
--   drop function if exists create_rating_moderation_row();
--   drop trigger if exists rating_moderation_set_updated_at on rating_moderation;
--   drop trigger if exists rating_moderation_ensure_tenant_match on rating_moderation;
--   drop function if exists ensure_rating_moderation_tenant_match();
--   drop table if exists rating_moderation;
--   alter table restaurant_profiles drop column if exists default_rating_moderation_status;
--   delete from role_permissions where permission_key in ('reviews.read', 'reviews.moderate');
--   delete from permissions where key in ('reviews.read', 'reviews.moderate');
-- ============================================================================

insert into permissions (key, description)
values
  ('reviews.read', 'View the tenant''s guest ratings, including their moderation status'),
  ('reviews.moderate', 'Release or hide a guest rating (moderation queue)')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as every other permission added after ticket #9.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key in ('reviews.read', 'reviews.moderate')
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'reviews.read'),
      ('manager', 'reviews.moderate')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- Same "existing tenants backfilled above, new tenants via this function
-- going forward" pattern as every prior permission addition. Function body
-- is otherwise byte-for-byte identical to the previous version
-- (20260817100000_orders_manage_permission_and_status_transitions.sql's
-- replace).
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
    (v_manager_role_id, 'reviews.read'),
    (v_manager_role_id, 'reviews.moderate'),
    (v_kitchen_role_id, 'menu.read'),
    (v_kitchen_role_id, 'menu.availability.manage'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_kitchen_role_id, 'orders.manage'),
    (v_service_role_id, 'menu.read'),
    (v_service_role_id, 'menu.availability.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_service_role_id, 'orders.manage'),
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
-- Configurable initial moderation status (acceptance criterion 1).
-- ----------------------------------------------------------------------------
alter table restaurant_profiles
  add column default_rating_moderation_status text not null default 'pending'
    check (default_rating_moderation_status in ('pending', 'released', 'hidden'));

comment on column restaurant_profiles.default_rating_moderation_status is
  'Moderation status a newly-submitted rating starts in (ticket #34). "pending" (default) requires a reviews.moderate holder to release/hide it before any future public display; a tenant may configure "released" to auto-publish, or "hidden" to require an explicit release for every rating.';

-- ----------------------------------------------------------------------------
-- rating_moderation -- one row per rating, tenant-scoped.
-- ----------------------------------------------------------------------------
create table rating_moderation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  rating_id uuid not null unique references ratings (id) on delete cascade,
  status text not null check (status in ('pending', 'released', 'hidden')),
  moderated_by_user_id uuid references auth.users (id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table rating_moderation is
  'Moderation state for one ratings row (ticket #34). Created automatically for every new rating (create_rating_moderation_row()) using the tenant''s configured default status. Status changes only through moderate_rating(), gated on reviews.moderate, and audited via audit_rating_moderation_change().';

create index rating_moderation_tenant_id_idx on rating_moderation (tenant_id);
create index rating_moderation_tenant_id_status_idx on rating_moderation (tenant_id, status);

create trigger rating_moderation_set_updated_at
  before update on rating_moderation
  for each row
  execute function set_updated_at();

-- Same-tenant integrity guard, mirroring ensure_rating_row_tenant_match()'s
-- precedent from ticket #33's own migration.
create or replace function ensure_rating_moderation_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  select tenant_id into v_expected_tenant_id from public.ratings where id = new.rating_id;
  if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
    raise exception 'rating_moderation.tenant_id must match its rating' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rating_moderation_ensure_tenant_match
  before insert or update on rating_moderation
  for each row
  execute function ensure_rating_moderation_tenant_match();

-- ----------------------------------------------------------------------------
-- Auto-create the moderation row for every new rating, using the tenant's
-- configured default status (acceptance criterion 1).
-- ----------------------------------------------------------------------------
create or replace function create_rating_moderation_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default_status text;
begin
  select coalesce(rp.default_rating_moderation_status, 'pending')
    into v_default_status
    from public.restaurant_profiles rp
   where rp.tenant_id = new.tenant_id;

  insert into public.rating_moderation (tenant_id, rating_id, status)
  values (new.tenant_id, new.id, coalesce(v_default_status, 'pending'));

  return new;
end;
$$;

comment on function create_rating_moderation_row() is
  'Ticket #34: creates the rating_moderation row for a newly-submitted rating, starting in the tenant''s configured default status (restaurant_profiles.default_rating_moderation_status, "pending" if the tenant has no profile row).';

create trigger ratings_create_moderation_row
  after insert on ratings
  for each row
  execute function create_rating_moderation_row();

-- ----------------------------------------------------------------------------
-- RLS -- rating_moderation
-- ----------------------------------------------------------------------------
alter table rating_moderation enable row level security;

-- No insert/update/delete grant for `authenticated` at all: every write goes
-- exclusively through moderate_rating() (SECURITY DEFINER, runs with the
-- function owner's privileges) or the ratings_create_moderation_row trigger
-- above -- mirrors transition_order_status()'s precedent of a SECURITY
-- DEFINER write path needing no table-level authenticated grant.
grant select on rating_moderation to authenticated;
grant select, insert, update on rating_moderation to service_role;

revoke truncate on rating_moderation from anon, authenticated, service_role;

create policy rating_moderation_select_reviews_read
  on rating_moderation
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'reviews.read'));

-- ----------------------------------------------------------------------------
-- RLS -- ratings: the reviews.read-gated SELECT policy ticket #33 explicitly
-- deferred to this ticket (see 20260819090000_ratings_guest_submission.sql's
-- header). No other policy/grant on `ratings` changes here.
-- ----------------------------------------------------------------------------
grant select on ratings to authenticated;

create policy ratings_select_reviews_read
  on ratings
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'reviews.read'));

-- ----------------------------------------------------------------------------
-- list_tenant_ratings_for_moderation -- narrow, reviews.read-gated join for
-- the admin moderation list's single round-trip (mirrors
-- get_tenant_order_payment_statuses()'s precedent of a narrow, permission-
-- gated projection RPC for a staff list view).
-- ----------------------------------------------------------------------------
create or replace function list_tenant_ratings_for_moderation(p_tenant_id uuid)
returns table (
  rating_id uuid,
  stars smallint,
  comment text,
  rated_at timestamptz,
  status text,
  moderated_by_user_id uuid,
  moderated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'reviews.read');

  return query
    select r.id as rating_id,
           r.stars,
           r.comment,
           r.created_at as rated_at,
           rm.status,
           rm.moderated_by_user_id,
           rm.moderated_at
      from public.ratings r
      join public.rating_moderation rm on rm.rating_id = r.id
     where r.tenant_id = p_tenant_id
     order by r.created_at desc;
end;
$$;

comment on function list_tenant_ratings_for_moderation(uuid) is
  'Ticket #34: reviews.read-gated projection of a tenant''s ratings joined with their moderation status, for the admin moderation list.';

revoke all on function list_tenant_ratings_for_moderation(uuid) from public;
grant execute on function list_tenant_ratings_for_moderation(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- moderate_rating -- the sole staff-facing write path for a rating's
-- moderation status (acceptance criterion 2).
-- ----------------------------------------------------------------------------
create or replace function moderate_rating(p_tenant_id uuid, p_rating_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.rating_moderation.status%type;
begin
  perform public.require_tenant_permission(p_tenant_id, 'reviews.moderate');

  if p_status not in ('pending', 'released', 'hidden') then
    raise exception 'Invalid moderation status: %', p_status using errcode = 'invalid_parameter_value';
  end if;

  update public.rating_moderation
     set status = p_status,
         moderated_by_user_id = auth.uid(),
         moderated_at = now()
   where rating_id = p_rating_id
     and tenant_id = p_tenant_id
  returning status into v_status;

  if not found then
    raise exception 'Rating not found' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('ratingId', p_rating_id, 'status', v_status);
end;
$$;

comment on function moderate_rating(uuid, uuid, text) is
  'Ticket #34: staff-facing moderation status change (pending/released/hidden), gated on reviews.moderate (independently re-checked here on top of the caller''s own requireTenantPermission call). Audited by audit_rating_moderation_change() below.';

revoke all on function moderate_rating(uuid, uuid, text) from public;
grant execute on function moderate_rating(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Observability: audit every moderation status change (ticket's own
-- "Moderationsentscheidungen auditiert" note). Mirrors audit_rbac_change()'s
-- precedent (20260801080000_roles_and_permissions_rbac.sql) of auditing via
-- an AFTER UPDATE trigger, so this is never dependent on every future write
-- path remembering to call an application-layer audit helper.
-- ----------------------------------------------------------------------------
create or replace function audit_rating_moderation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      new.tenant_id,
      coalesce(new.moderated_by_user_id, auth.uid()),
      'reviews.moderation_status_changed',
      'rating_moderation',
      new.id::text,
      jsonb_build_object('ratingId', new.rating_id, 'fromStatus', old.status, 'toStatus', new.status)
    );
  end if;

  return new;
end;
$$;

comment on function audit_rating_moderation_change() is
  'Ticket #34: appends an audit_logs row whenever a rating_moderation row''s status actually changes.';

create trigger rating_moderation_audit_status_change
  after update on rating_moderation
  for each row
  execute function audit_rating_moderation_change();

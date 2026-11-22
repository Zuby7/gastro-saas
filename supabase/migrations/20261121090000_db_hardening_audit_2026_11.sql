-- ============================================================================
-- Database hardening after the 2026-11 audit (issue #205, risk:security,
-- risk:migration)
-- ============================================================================
-- One additive, idempotent migration. Every statement is create or replace,
-- drop ... if exists + create, or create ... if not exists. No data is
-- deleted or rewritten, with ONE deliberate exception documented in item 10
-- (a completely empty draft menu version is replaced by a clone of the
-- published version on next access).
--
-- Items (see docs/security/tenant-isolation.md and docs/data/domain-model.md):
--   1. refunds: direct INSERT limited to a pending reservation by the caller.
--   2. accept_invitation: member holds exactly the invited role; one tenant
--      per account.
--   3. Role escalation: membership_roles INSERT / create_invitation require
--      the granted role's permissions to be a subset of the caller's (or
--      roles.manage); owner stays protected.
--   4. audit_logs / analytics_events: no direct INSERT for authenticated;
--      audit rows are written via record_audit_event().
--   5. menu_versions: forced draft on insert for app roles, DELETE only for
--      drafts, ensure_menu_version_editable checks OLD and NEW parent.
--   6. manual_sales_entries: dish/tenant match trigger, entered_by_user_id
--      forced to auth.uid() for app roles (also inside
--      commit_sales_import_batch).
--   7. Function EXECUTE privileges: anon only the public guest RPCs,
--      service_role-only functions revoked from anon/authenticated.
--   8. orders_one_active_per_cart_idx re-scoped to awaiting_payment.
--   9. build_cart_view: deterministic line order.
--  10. create_initial_draft_menu_version clones the published version.
--  11. Missing foreign key / listing indexes.
--
-- Rollback note (local/throwaway DBs; no data was changed, only definitions):
--   * Policies: drop policy if exists refunds_insert_payments_refund,
--     membership_roles_insert_users_manage, menu_versions_delete_write and
--     re-create them from 20260809090000 / 20260801080000 / 20260801110000;
--     re-create audit_logs_insert_member and analytics_events_insert_member
--     from 20260801050000 plus `grant insert ... to authenticated`.
--   * Functions: re-apply the previous bodies of accept_invitation,
--     create_invitation (20260801100000), ensure_menu_version_editable and
--     build_cart_view and clone/commit functions (20260817110000,
--     20260906150000), create_initial_draft_menu_version (20260802090000).
--   * drop function if exists record_audit_event(uuid, text, text, text, jsonb);
--     drop function if exists caller_covers_role_permissions(uuid, uuid);
--   * drop trigger if exists menu_versions_force_draft_on_insert on menu_versions;
--     drop trigger if exists manual_sales_entries_guard on manual_sales_entries;
--   * drop index if exists orders_one_active_per_cart_idx; then re-create it
--     with `where cart_id is not null and status <> 'cancelled'`.
--   * Execute privileges: grant execute on function ... back to anon /
--     authenticated if (and only if) a consumer genuinely needs it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. refunds: the authenticated INSERT is only the pending reservation.
-- ----------------------------------------------------------------------------
-- Finalization is service_role-only (finalize_refund()). Before this change a
-- payments.refund holder could insert rows already 'succeeded'/'unconfirmed'
-- with a fake stripe_refund_id and an arbitrary actor_user_id.
drop policy if exists refunds_insert_payments_refund on refunds;

create policy refunds_insert_payments_refund
  on refunds
  for insert
  to authenticated
  with check (
    has_tenant_permission(tenant_id, 'payments.refund')
    and status = 'pending'
    and stripe_refund_id is null
    and actor_user_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 3 (helper). caller_covers_role_permissions: true if every permission of the
-- role is also held by the calling user (auth.uid()) in the tenant.
-- ----------------------------------------------------------------------------
create or replace function caller_covers_role_permissions(p_tenant_id uuid, p_role_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = p_role_id
       and not exists (
         select 1
           from public.tenant_memberships tm
           join public.membership_roles mr on mr.membership_id = tm.id
           join public.role_permissions crp on crp.role_id = mr.role_id
          where tm.tenant_id = p_tenant_id
            and tm.user_id = auth.uid()
            and crp.permission_key = rp.permission_key
       )
  );
$$;

comment on function caller_covers_role_permissions(uuid, uuid) is
  'True if every permission of the given role is also held by the calling user (auth.uid()) in the tenant. Used to prevent privilege escalation by granting or inviting into a role that is more powerful than the caller.';

revoke all on function caller_covers_role_permissions(uuid, uuid) from public, anon;
grant execute on function caller_covers_role_permissions(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. membership_roles INSERT: no escalation beyond the caller's own powers.
-- ----------------------------------------------------------------------------
drop policy if exists membership_roles_insert_users_manage on membership_roles;

create policy membership_roles_insert_users_manage
  on membership_roles
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.tenant_memberships tm
        join public.roles r on r.id = role_id and r.tenant_id = tm.tenant_id
       where tm.id = membership_id
         and has_tenant_permission(tm.tenant_id, 'users.manage')
         and (r.key <> 'owner' or has_tenant_permission(tm.tenant_id, 'roles.manage'))
         and (
           has_tenant_permission(tm.tenant_id, 'roles.manage')
           or caller_covers_role_permissions(tm.tenant_id, r.id)
         )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. create_invitation: same escalation rule for invitations.
-- ----------------------------------------------------------------------------
create or replace function create_invitation(
  p_tenant_id uuid,
  p_email text,
  p_role_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_user_id uuid := auth.uid();
  v_invitation_id uuid;
  v_role_key text;
begin
  if v_inviter_user_id is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.require_tenant_permission(p_tenant_id, 'users.invite');

  if p_expires_at <= now() then
    raise exception 'Invitation expiry must be in the future'
      using errcode = 'check_violation';
  end if;

  select r.key into v_role_key
    from public.roles r
   where r.id = p_role_id
     and r.tenant_id = p_tenant_id;

  if v_role_key is null then
    raise exception 'Invitation role must belong to the invitation tenant'
      using errcode = 'check_violation';
  end if;

  if v_role_key = 'owner' and not public.has_tenant_permission(p_tenant_id, 'roles.manage') then
    raise exception 'Inviting as Owner requires the roles.manage permission'
      using errcode = 'insufficient_privilege';
  end if;

  -- Audit 2026-11: any role more powerful than the inviter's own permissions
  -- needs roles.manage (otherwise users.invite alone is an escalation path).
  if not public.has_tenant_permission(p_tenant_id, 'roles.manage')
     and not public.caller_covers_role_permissions(p_tenant_id, p_role_id)
  then
    raise exception 'Inviting into this role requires the roles.manage permission'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.invitations (
    tenant_id,
    email,
    role_id,
    token_hash,
    expires_at,
    created_by_user_id
  )
  values (
    p_tenant_id,
    lower(trim(p_email)),
    p_role_id,
    p_token_hash,
    p_expires_at,
    v_inviter_user_id
  )
  returning id into v_invitation_id;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id)
  values (p_tenant_id, v_inviter_user_id, 'invitation.created', 'invitation', v_invitation_id::text);

  return v_invitation_id;
end;
$$;

comment on function create_invitation(uuid, text, uuid, text, timestamptz) is
  'Creates a single-use tenant invitation after checking users.invite, role tenant-scope, and that the invited role is not more powerful than the inviter (owner and any role beyond the inviter''s permissions need roles.manage). Raw tokens are generated app-side; only token_hash is stored.';

revoke all on function create_invitation(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function create_invitation(uuid, text, uuid, text, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. accept_invitation: exactly the invited role, one tenant per account.
-- ----------------------------------------------------------------------------
create or replace function accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation public.invitations%rowtype;
  v_role_key text;
  v_membership_role text;
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select lower(email) into v_user_email
    from auth.users
   where id = v_user_id;

  select *
    into v_invitation
    from public.invitations
   where token_hash = p_token_hash
   for update;

  if v_invitation.id is null then
    raise exception 'Invitation link is invalid.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'Invitation link has already been used.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'Invitation link has expired.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_user_email is null or v_user_email <> v_invitation.email then
    raise exception 'Invitation is only valid for %.', v_invitation.email
      using errcode = 'insufficient_privilege';
  end if;

  -- Mirrors create_tenant_with_owner(): one account belongs to at most one
  -- tenant (same rule, same error code and message).
  if exists (select 1 from public.tenant_memberships where user_id = v_user_id) then
    raise exception 'This account already belongs to a tenant'
      using errcode = 'unique_violation';
  end if;

  select key into v_role_key
    from public.roles
   where id = v_invitation.role_id
     and tenant_id = v_invitation.tenant_id;

  if v_role_key is null then
    raise exception 'Invitation role no longer exists.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_membership_role := case v_role_key
    when 'owner' then 'owner'
    when 'manager' then 'manager'
    else 'staff'
  end;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (v_invitation.tenant_id, v_user_id, v_membership_role)
  returning id into v_membership_id;

  -- sync_membership_standard_role() has just auto-assigned the standard
  -- role derived from tenant_memberships.role (staff -> 'service'). The
  -- member must hold exactly the invited role, so drop every other
  -- assignment and make sure the invited one is present.
  delete from public.membership_roles
   where membership_id = v_membership_id
     and role_id <> v_invitation.role_id;

  insert into public.membership_roles (membership_id, role_id)
  values (v_membership_id, v_invitation.role_id)
  on conflict do nothing;

  update public.invitations
     set accepted_at = now(),
         accepted_by_user_id = v_user_id
   where id = v_invitation.id;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id)
  values (v_invitation.tenant_id, v_user_id, 'invitation.accepted', 'invitation', v_invitation.id::text);

  return v_invitation.tenant_id;
end;
$$;

comment on function accept_invitation(text) is
  'Accepts a still-valid, unused invitation for the authenticated user email, creates the tenant membership holding exactly the invited role (no auto-assigned standard role on top), rejects accounts that already belong to a tenant, then marks the invitation used.';

revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. audit_logs / analytics_events: no direct INSERT for app sessions.
-- ----------------------------------------------------------------------------
-- Every writer is a SECURITY DEFINER function, the service role, or (for
-- audit rows written on behalf of a signed-in user) record_audit_event()
-- below. analytics_events has no user-session writer at all.
drop policy if exists audit_logs_insert_member on audit_logs;
revoke insert on audit_logs from authenticated;

drop policy if exists analytics_events_insert_member on analytics_events;
revoke insert on analytics_events from authenticated;

create or replace function record_audit_event(
  p_tenant_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if v_actor_user_id is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not a member of this tenant'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    v_actor_user_id,
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

comment on function record_audit_event(uuid, text, text, text, jsonb) is
  'Appends one audit_logs row on behalf of the signed-in user: actor_user_id is always auth.uid() (never client-supplied) and the caller must be a member of p_tenant_id. Replaces the former direct INSERT policy on audit_logs. Metadata content validation (secret/payment shapes) stays an application-layer guarantee (assertSafeAuditMetadata).';

revoke all on function record_audit_event(uuid, text, text, text, jsonb) from public, anon;
grant execute on function record_audit_event(uuid, text, text, text, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. menu_versions
-- ----------------------------------------------------------------------------
-- (a) A menu.write holder could INSERT a row directly as 'published' (the
-- UPDATE status guard did not cover INSERT). App-facing roles now always
-- insert drafts; publishing stays exclusive to publish_menu_version().
create or replace function guard_menu_versions_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) in ('authenticated', 'anon', 'service_role') then
    new.status := 'draft';
    new.published_at := null;
    new.published_by_user_id := null;
  end if;
  return new;
end;
$$;

comment on function guard_menu_versions_insert() is
  'Forces status = draft and published_at / published_by_user_id = null on INSERT for authenticated, anon and service_role (same app-facing role set as guard_menu_versions_status_change()). Privileged connections (current_setting(''role'') = ''none'') are not restricted.';

drop trigger if exists menu_versions_force_draft_on_insert on menu_versions;
create trigger menu_versions_force_draft_on_insert
  before insert on menu_versions
  for each row
  execute function guard_menu_versions_insert();

-- (b) DELETE only for drafts (published/archived versions are history and
-- are referenced by the live menu).
-- apply_basic_tenant_policies() created the original policy under the
-- schema-qualified name "public.menu_versions_delete_write" (regclass::text),
-- so that exact name must be dropped, not just the unqualified one.
drop policy if exists "public.menu_versions_delete_write" on menu_versions;
drop policy if exists menu_versions_delete_write on menu_versions;
create policy menu_versions_delete_write
  on menu_versions
  for delete
  to authenticated
  using (has_tenant_permission(tenant_id, 'menu.write') and status = 'draft');

-- (c) ensure_menu_version_editable: check the OLD parent as well as the NEW
-- one, so a row cannot be moved out of (or into) a non-draft menu version by
-- changing its parent reference. Body otherwise identical to
-- 20260817110000_dish_option_availability_and_scheduling.sql.
create or replace function ensure_menu_version_editable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  -- Nested (not one flat boolean): see the comment in the original
  -- definition -- PL/pgSQL plans each IF condition against the record type
  -- of the triggering table.
  if tg_table_name = 'dish_variants' and tg_op = 'UPDATE' then
    if (new.is_available is distinct from old.is_available
        or new.available_again_at is distinct from old.available_again_at)
       and to_jsonb(new) - 'is_available' - 'available_again_at' - 'updated_at'
           = to_jsonb(old) - 'is_available' - 'available_again_at' - 'updated_at'
    then
      return new;
    end if;
  end if;

  if tg_table_name = 'dishes' and tg_op = 'UPDATE' then
    if (new.is_available is distinct from old.is_available
        or new.available_again_at is distinct from old.available_again_at)
       and to_jsonb(new) - 'is_available' - 'available_again_at' - 'updated_at'
           = to_jsonb(old) - 'is_available' - 'available_again_at' - 'updated_at'
    then
      return new;
    end if;
  end if;

  if tg_table_name in ('categories', 'dishes') then
    if tg_op in ('UPDATE', 'DELETE') then
      select status into v_old_status from public.menu_versions where id = old.menu_version_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      select status into v_new_status from public.menu_versions where id = new.menu_version_id;
    end if;
  else
    if tg_op in ('UPDATE', 'DELETE') then
      select mv.status into v_old_status
        from public.dishes d
        join public.menu_versions mv on mv.id = d.menu_version_id
       where d.id = old.dish_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      select mv.status into v_new_status
        from public.dishes d
        join public.menu_versions mv on mv.id = d.menu_version_id
       where d.id = new.dish_id;
    end if;
  end if;

  if v_old_status is not null and v_old_status <> 'draft' then
    raise exception '% is read-only once its menu version leaves draft status (current status: %)', tg_table_name, v_old_status
      using errcode = 'read_only_sql_transaction';
  end if;

  if v_new_status is not null and v_new_status <> 'draft' then
    raise exception '% is read-only once its menu version leaves draft status (current status: %)', tg_table_name, v_new_status
      using errcode = 'read_only_sql_transaction';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. manual_sales_entries
-- ----------------------------------------------------------------------------
create or replace function guard_manual_sales_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dish_tenant_id uuid;
begin
  select tenant_id into v_dish_tenant_id from public.dishes where id = new.dish_id;

  if v_dish_tenant_id is null or v_dish_tenant_id <> new.tenant_id then
    raise exception 'manual_sales_entries.dish_id must belong to the same tenant'
      using errcode = 'check_violation';
  end if;

  -- Accountability field: app-facing callers cannot attribute an entry to
  -- someone else (or hide who entered it).
  if current_setting('role', true) in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.entered_by_user_id := auth.uid();
    else
      new.entered_by_user_id := old.entered_by_user_id;
    end if;
  end if;

  return new;
end;
$$;

comment on function guard_manual_sales_entry() is
  'Rejects a dish_id from another tenant and forces entered_by_user_id = auth.uid() on INSERT (kept unchanged on UPDATE) for authenticated/anon callers.';

drop trigger if exists manual_sales_entries_guard on manual_sales_entries;
create trigger manual_sales_entries_guard
  before insert or update on manual_sales_entries
  for each row
  execute function guard_manual_sales_entry();

create or replace function commit_sales_import_batch(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_entries jsonb,
  p_entered_by_user_id uuid default null
) returns table (claimed boolean, imported_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_id uuid;
  v_imported_count integer;
  v_entered_by_user_id uuid;
begin
  perform public.require_tenant_permission(p_tenant_id, 'analytics.manualsales.write');

  -- Never trust a client-supplied actor: signed-in callers are always
  -- recorded as themselves; only a service_role caller may pass a user id.
  if current_setting('role', true) in ('authenticated', 'anon') then
    v_entered_by_user_id := auth.uid();
  else
    v_entered_by_user_id := p_entered_by_user_id;
  end if;

  update public.sales_import_batches
     set status = 'committed',
         committed_at = now()
   where id = p_batch_id
     and tenant_id = p_tenant_id
     and status = 'pending'
  returning id into v_claimed_id;

  if v_claimed_id is null then
    return query select false, 0;
    return;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_entries) as entry
     where not exists (
       select 1
         from public.dishes d
        where d.id = (entry ->> 'dishId')::uuid
          and d.tenant_id = p_tenant_id
     )
  ) then
    raise exception 'commit_sales_import_batch: entry references a dish not owned by tenant %', p_tenant_id
      using errcode = '22023';
  end if;

  insert into public.manual_sales_entries
    (tenant_id, dish_id, quantity, sale_date, channel, entered_by_user_id)
  select p_tenant_id,
         (entry ->> 'dishId')::uuid,
         (entry ->> 'quantity')::integer,
         (entry ->> 'saleDate')::date,
         nullif(entry ->> 'channel', ''),
         v_entered_by_user_id
    from jsonb_array_elements(p_entries) as entry;

  get diagnostics v_imported_count = row_count;

  return query select true, v_imported_count;
end;
$$;

comment on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) is
  'Atomically claims a pending sales_import_batches row and bulk-inserts the pre-validated entries into manual_sales_entries. Enforces analytics.manualsales.write, re-verifies every dish_id belongs to p_tenant_id, and records entered_by_user_id as auth.uid() for signed-in callers (p_entered_by_user_id is only honoured for service_role).';

revoke all on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. One awaiting_payment order per cart (not one non-cancelled order ever).
-- ----------------------------------------------------------------------------
-- The old predicate (status <> 'cancelled') meant a guest cart (cookie, 14
-- days) could only ever produce ONE order: after a paid order the second
-- checkout from the same cart failed with a unique violation. The purpose of
-- the index is idempotency against double submits while an order is still
-- unpaid, which `status = 'awaiting_payment'` expresses exactly. The
-- create_order_from_cart() row lock + empty-cart check are unchanged.
drop index if exists orders_one_active_per_cart_idx;
create unique index orders_one_active_per_cart_idx on orders (cart_id)
  where cart_id is not null and status = 'awaiting_payment';

-- ----------------------------------------------------------------------------
-- 9. build_cart_view: deterministic line order (created_at, id).
-- ----------------------------------------------------------------------------
-- Body identical to 20260817110000_dish_option_availability_and_scheduling.sql
-- except for the added cart_item_created_at column and the ordering.
create or replace function build_cart_view(p_cart_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with current_pub as (
    select mv.id, mv.tenant_id
      from public.menu_versions mv
      join public.carts c on c.tenant_id = mv.tenant_id
     where c.id = p_cart_id
       and mv.status = 'published'
     order by mv.published_at desc nulls last
     limit 1
  ),
  live_lines as (
    select
      ci.id as cart_item_id,
      ci.created_at as cart_item_created_at,
      ci.dish_id,
      ci.dish_variant_id,
      ci.quantity,
      coalesce(d.name, ci.dish_name_snapshot) as dish_name,
      coalesce(dv.name, ci.variant_name_snapshot) as variant_name,
      coalesce(dv.price_cents, d.price_cents, 0) as unit_price_cents,
      (
        d.id is not null
        and d.archived_at is null
        and d.menu_version_id = (select cp.id from current_pub cp)
        and public.is_menu_item_available(d.is_available, d.available_again_at)
        and (
          ci.dish_variant_id is null
          or (dv.id is not null and public.is_menu_item_available(dv.is_available, dv.available_again_at))
        )
      ) as dish_available
    from public.cart_items ci
    left join public.dishes d on d.id = ci.dish_id
    left join public.dish_variants dv on dv.id = ci.dish_variant_id
    where ci.cart_id = p_cart_id
  ),
  line_selections as (
    select
      cis.cart_item_id,
      jsonb_agg(
        jsonb_build_object(
          'optionId', cis.option_id,
          'name', coalesce(o.name, cis.option_name_snapshot),
          'priceDeltaCents', coalesce(o.price_delta_cents, cis.price_delta_cents_snapshot),
          'isAvailable', o.id is not null and public.is_menu_item_available(o.is_available, o.available_again_at)
        )
        order by coalesce(o.sort_order, 0), coalesce(o.name, cis.option_name_snapshot)
      ) as selections,
      bool_and(o.id is not null and public.is_menu_item_available(o.is_available, o.available_again_at)) as selections_available,
      sum(coalesce(o.price_delta_cents, cis.price_delta_cents_snapshot)) as selections_total_cents
    from public.cart_item_selections cis
    left join public.options o on o.id = cis.option_id
    where cis.cart_item_id in (select ci.id from public.cart_items ci where ci.cart_id = p_cart_id)
    group by cis.cart_item_id
  ),
  priced_lines as (
    select
      ll.*,
      coalesce(ls.selections, '[]'::jsonb) as selections,
      coalesce(ls.selections_total_cents, 0) as selections_total_cents,
      (ll.dish_available and coalesce(ls.selections_available, true)) as is_available
    from live_lines ll
    left join line_selections ls on ls.cart_item_id = ll.cart_item_id
  )
  select jsonb_build_object(
    'cartId', p_cart_id,
    'currency', (select currency from public.carts where id = p_cart_id),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'cartItemId', pl.cart_item_id,
          'dishId', pl.dish_id,
          'dishName', pl.dish_name,
          'variantId', pl.dish_variant_id,
          'variantName', pl.variant_name,
          'quantity', pl.quantity,
          'unitPriceCents', pl.unit_price_cents,
          'selections', pl.selections,
          'selectionsTotalCents', pl.selections_total_cents,
          'lineTotalCents',
            case when pl.is_available
              then (pl.unit_price_cents + pl.selections_total_cents) * pl.quantity
              else 0
            end,
          'isAvailable', pl.is_available
        )
        order by pl.cart_item_created_at, pl.cart_item_id
      ) filter (where pl.cart_item_id is not null),
      '[]'::jsonb
    ),
    'totalCents', coalesce(sum(
      case when pl.is_available
        then (pl.unit_price_cents + pl.selections_total_cents) * pl.quantity
        else 0
      end
    ), 0),
    'itemCount', count(pl.cart_item_id),
    'hasUnavailableItems', coalesce(bool_or(not pl.is_available), false),
    'checkoutReady', count(pl.cart_item_id) > 0 and coalesce(bool_and(pl.is_available), false)
  )
  from priced_lines pl;
$$;

-- ----------------------------------------------------------------------------
-- 10. create_initial_draft_menu_version: never hand out an empty draft while
-- a published menu exists.
-- ----------------------------------------------------------------------------
-- Previously, if a published version existed but no draft did, an EMPTY draft
-- was created; publishing it would archive the live menu and replace it with
-- nothing. Now the draft is a clone of the latest published version. A
-- current draft that is completely empty (no categories and no dishes) while
-- a published version exists is replaced by such a clone on next access (an
-- empty draft carries no work to lose).
create or replace function create_initial_draft_menu_version(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_draft_id uuid;
  v_published_id uuid;
  v_next_version_number integer;
  v_new_version_id uuid;
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.write');

  perform pg_advisory_xact_lock(hashtextextended('create_initial_draft_menu_version:' || p_tenant_id::text, 0));

  select id into v_published_id
    from public.menu_versions
   where tenant_id = p_tenant_id
     and status = 'published'
   order by published_at desc nulls last, version_number desc
   limit 1;

  select id into v_existing_draft_id
    from public.menu_versions
   where tenant_id = p_tenant_id
     and status = 'draft'
   order by created_at
   limit 1;

  if v_existing_draft_id is not null then
    if v_published_id is not null
       and not exists (select 1 from public.categories where menu_version_id = v_existing_draft_id)
       and not exists (select 1 from public.dishes where menu_version_id = v_existing_draft_id)
    then
      delete from public.menu_versions where id = v_existing_draft_id;
      return public.clone_menu_version_as_draft(v_published_id);
    end if;

    return v_existing_draft_id;
  end if;

  if v_published_id is not null then
    return public.clone_menu_version_as_draft(v_published_id);
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version_number
    from public.menu_versions
   where tenant_id = p_tenant_id;

  insert into public.menu_versions (tenant_id, status, version_number)
  values (p_tenant_id, 'draft', v_next_version_number)
  returning id into v_new_version_id;

  return v_new_version_id;
end;
$$;

comment on function create_initial_draft_menu_version(uuid) is
  'Get-or-create a tenant''s current draft menu_version (menu.write). When a published version exists the draft is a clone of it (never an empty draft that would blank the live menu on publish); a completely empty existing draft is replaced by such a clone. Concurrency-safe via pg_advisory_xact_lock keyed on tenant_id.';

revoke all on function create_initial_draft_menu_version(uuid) from public, anon;
grant execute on function create_initial_draft_menu_version(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. Indexes (foreign keys and the staff order listing).
-- ----------------------------------------------------------------------------
create index if not exists dishes_category_id_idx on dishes (category_id);
create index if not exists dishes_menu_version_id_idx on dishes (menu_version_id);
create index if not exists dishes_media_asset_id_idx on dishes (media_asset_id);
create index if not exists dish_variants_dish_id_idx on dish_variants (dish_id);
create index if not exists options_option_group_id_idx on options (option_group_id);
create index if not exists orders_tenant_id_created_at_idx on orders (tenant_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 7. Function EXECUTE privileges.
-- ----------------------------------------------------------------------------
-- `revoke ... from public` in the earlier migrations does NOT remove the
-- explicit grants Supabase's default privileges give anon/authenticated on
-- every function created in schema public, so functions meant to be
-- service_role-only were still callable through PostgREST by any signed-in
-- (or even anonymous) user. Close that explicitly.

-- (a) anon may execute only the public guest RPCs; every other function in
-- schema public loses its PUBLIC/anon execute. Trigger / event-trigger
-- functions and extension members are left alone (they cannot be called
-- directly).
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and p.proname not in ('get_public_menu', 'get_public_legal_page')
       and not exists (
         select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke execute on function %s from public, anon', v_fn.signature);
  end loop;
end;
$$;

-- Pure helper functions that previously relied on the implicit PUBLIC grant:
-- keep them available to signed-in sessions and the service role.
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('is_valid_order_status_transition', 'is_menu_item_available')
  loop
    execute format('grant execute on function %s to authenticated, service_role', v_fn.signature);
  end loop;
end;
$$;

-- (b) service_role-only functions: explicitly revoked from authenticated and
-- anon (matched by name so every overload is covered; names that do not
-- exist are simply skipped).
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'reserve_auth_rate_limit_attempt',
         'mark_auth_rate_limit_attempt_succeeded',
         'record_failed_login_audit_event',
         'clone_menu_version_as_draft',
         'get_or_create_cart',
         'build_cart_view',
         'get_cart_view',
         'add_cart_item',
         'update_cart_item_quantity',
         'remove_cart_item',
         'create_order_from_cart',
         'get_order_status_by_token',
         'apply_connect_account_snapshot',
         'claim_payment_webhook_event',
         'finalize_refund',
         'mark_order_received_and_paid',
         'compute_period_order_stats',
         'submit_order_rating',
         'get_tenant_rating_summary',
         'sweep_stale_awaiting_payment_orders',
         'purge_stale_menu_view_attempts',
         'purge_stale_dish_engagement_attempts',
         'purge_expired_sales_import_batches',
         'record_menu_view',
         'record_dish_view',
         'record_dish_views',
         'record_add_to_cart_event'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn.signature);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. export_tenant_data: Owner-only (tenant.data.delete), same as the web route.
-- ----------------------------------------------------------------------------
-- The function returns team e-mails, guest PII (names, phone numbers) and
-- payments. It was gated on tenant.settings.write (Manager), so a Manager
-- could call the RPC directly even though the app route requires
-- tenant.data.delete. Body identical to 20260819110000 except the permission.
create or replace function export_tenant_data(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_result jsonb;
begin
  perform public.require_tenant_permission(p_tenant_id, 'tenant.data.delete');

  select jsonb_build_object(
    'exportedAt', now(),
    'tenantId', p_tenant_id,
    'tenant', (
      select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'createdAt', t.created_at)
        from public.tenants t
       where t.id = p_tenant_id
    ),
    'restaurantProfile', (
      select to_jsonb(rp) - 'tenant_id'
        from public.restaurant_profiles rp
       where rp.tenant_id = p_tenant_id
    ),
    'openingHours', (
      select coalesce(jsonb_agg(to_jsonb(oh) - 'tenant_id' order by oh.weekday), '[]'::jsonb)
        from public.opening_hours oh
       where oh.tenant_id = p_tenant_id
    ),
    'team', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'userId', tm.user_id,
            'email', u.email,
            'role', tm.role,
            'memberSince', tm.created_at
          )
        ),
        '[]'::jsonb
      )
        from public.tenant_memberships tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = p_tenant_id
    ),
    'menu', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'name', d.name,
            'description', d.description,
            'priceCents', d.price_cents,
            'currency', d.currency,
            'archivedAt', d.archived_at
          )
        ),
        '[]'::jsonb
      )
        from public.dishes d
       where d.tenant_id = p_tenant_id
    ),
    'orders', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'status', o.status,
            'fulfillmentType', o.fulfillment_type,
            'customerName', o.customer_name,
            'customerPhone', o.customer_phone,
            'tableIdentifier', o.table_identifier,
            'customerNote', o.customer_note,
            'totalCents', o.total_cents,
            'currency', o.currency,
            'createdAt', o.created_at,
            'items', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'dishName', oi.dish_name_snapshot,
                    'variantName', oi.variant_name_snapshot,
                    'quantity', oi.quantity,
                    'unitPriceCents', oi.unit_price_cents_snapshot,
                    'currency', oi.currency
                  )
                ),
                '[]'::jsonb
              )
                from public.order_items oi
               where oi.order_id = o.id
            )
          )
          order by o.created_at desc
        ),
        '[]'::jsonb
      )
        from public.orders o
       where o.tenant_id = p_tenant_id
    ),
    'payments', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'orderId', p.order_id,
            'status', p.status,
            'amountCents', p.amount_cents,
            'currency', p.currency,
            'createdAt', p.created_at
          )
          order by p.created_at desc
        ),
        '[]'::jsonb
      )
        from public.payments p
       where p.tenant_id = p_tenant_id
    ),
    'retentionSettings', (
      select jsonb_build_object('analyticsEventsRetentionDays', prs.analytics_events_retention_days)
        from public.privacy_retention_settings prs
       where prs.tenant_id = p_tenant_id
    ),
    'deletionRequests', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', ddr.id,
            'status', ddr.status,
            'requestedAt', ddr.requested_at,
            'processedAt', ddr.processed_at,
            'retainedOrdersCount', ddr.retained_orders_count,
            'anonymizedOrdersCount', ddr.anonymized_orders_count,
            'analyticsEventsPurgedCount', ddr.analytics_events_purged_count
          )
          order by ddr.requested_at desc
        ),
        '[]'::jsonb
      )
        from public.data_deletion_requests ddr
       where ddr.tenant_id = p_tenant_id
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function export_tenant_data(uuid) is
  'Assembles the tenant''s own operational data (profile, opening hours, team, basic menu, orders/items, payments, retention settings, deletion-request history) as one jsonb document. Gated on tenant.data.delete (Owner only) because it contains team e-mails and guest PII. Every referenced table is explicitly filtered by p_tenant_id in this function body.';

revoke all on function export_tenant_data(uuid) from public, anon;
grant execute on function export_tenant_data(uuid) to authenticated, service_role;

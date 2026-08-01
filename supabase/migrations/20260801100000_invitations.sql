-- ============================================================================
-- Employee invitations (ticket #8)
-- ============================================================================
-- Single-use, expiring invitations scoped to one tenant and one role.
-- Raw invitation tokens are never stored; only a SHA-256 hex hash reaches DB.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists accept_invitation(text);
--   drop function if exists create_invitation(uuid, text, uuid, text, timestamptz);
--   drop table if exists invitations;
-- ============================================================================

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) > 0),
  role_id uuid not null references roles (id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (accepted_at is null or accepted_by_user_id is not null)
);

comment on table invitations is
  'Single-use employee invitations. Tenant- and role-scoped. Stores only token_hash, never the raw invite token.';

create index invitations_tenant_id_idx on invitations (tenant_id);
create index invitations_email_idx on invitations (email);
create index invitations_role_id_idx on invitations (role_id);

alter table invitations enable row level security;

grant select, insert, update on invitations to authenticated;
grant select, insert, update, delete on invitations to service_role;
revoke truncate on invitations from anon, authenticated, service_role;

create policy invitations_select_inviter
  on invitations
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'users.invite'));

-- Direct INSERT/UPDATE from app-facing sessions is intentionally closed.
-- create_invitation()/accept_invitation() own validation and state changes.

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

  if not exists (
    select 1 from public.roles r
     where r.id = p_role_id
       and r.tenant_id = p_tenant_id
  ) then
    raise exception 'Invitation role must belong to the invitation tenant'
      using errcode = 'check_violation';
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
  'Creates a single-use tenant invitation after checking users.invite and role tenant-scope. Raw tokens are generated app-side; only token_hash is stored.';

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
  'Accepts a still-valid, unused invitation for the authenticated user email, creates the tenant membership and role assignment, then marks the invitation used.';

revoke all on function create_invitation(uuid, text, uuid, text, timestamptz) from public;
revoke all on function accept_invitation(text) from public;
grant execute on function create_invitation(uuid, text, uuid, text, timestamptz) to authenticated;
grant execute on function accept_invitation(text) to authenticated;

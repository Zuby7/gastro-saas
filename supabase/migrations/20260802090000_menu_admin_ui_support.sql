-- ============================================================================
-- Admin UI support for Epic 4 (tickets #11-#15): the epic-3-5-batch Opus
-- review flagged that #11-#15 shipped DB-only (schema/RLS/functions) with no
-- admin UI at all. This migration adds the one piece of server-side plumbing
-- the UI needs that didn't already exist: a way to get-or-create a tenant's
-- first editable draft menu version. Everything else the UI needs
-- (categories/dishes/variants/options/allergens/etc CRUD, run_menu_publish_checks,
-- publish_menu_version) already exists from 20260801110000_*.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_initial_draft_menu_version: idempotent get-or-create of a tenant's
-- current draft menu version. Without this, a brand-new tenant has zero
-- menu_versions rows and the admin menu editor has nothing to attach
-- categories/dishes to -- clone_menu_version_as_draft() only clones an
-- *existing* version, it doesn't bootstrap the very first one.
-- ----------------------------------------------------------------------------
create or replace function create_initial_draft_menu_version(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_draft_id uuid;
  v_next_version_number integer;
  v_new_version_id uuid;
begin
  perform public.require_tenant_permission(p_tenant_id, 'menu.write');

  select id into v_existing_draft_id
    from public.menu_versions
   where tenant_id = p_tenant_id
     and status = 'draft'
   order by created_at
   limit 1;

  if v_existing_draft_id is not null then
    return v_existing_draft_id;
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
  'Get-or-create a tenant''s current draft menu_version. Gated on menu.write via require_tenant_permission (same permission the RLS policies on menu_versions already require), tenant_id always taken from the caller''s own argument which the application resolves from the authenticated session''s membership, never from client-supplied context.';

revoke all on function create_initial_draft_menu_version(uuid) from public;
grant execute on function create_initial_draft_menu_version(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Storage: tenant-scoped bucket for dish/media images (ticket #12's image
-- upload requirement). Matches the existing media_assets check constraint
-- (`storage_path like tenant_id || '/%'`) -- objects must live under a
-- `<tenant_id>/...` path. Private bucket: reads/writes are gated by RLS
-- policies below, never a public bucket, per
-- docs/security/tenant-isolation.md's storage-object rule.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-media', 'dish-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy dish_media_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dish-media'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy dish_media_insert_write
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dish-media'
    and public.has_tenant_permission(((storage.foldername(name))[1])::uuid, 'menu.write')
  );

create policy dish_media_update_write
  on storage.objects for update to authenticated
  using (
    bucket_id = 'dish-media'
    and public.has_tenant_permission(((storage.foldername(name))[1])::uuid, 'menu.write')
  )
  with check (
    bucket_id = 'dish-media'
    and public.has_tenant_permission(((storage.foldername(name))[1])::uuid, 'menu.write')
  );

create policy dish_media_delete_write
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dish-media'
    and public.has_tenant_permission(((storage.foldername(name))[1])::uuid, 'menu.write')
  );

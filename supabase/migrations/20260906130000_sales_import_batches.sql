-- ============================================================================
-- Excel-Import für historische Verkaufsdaten (Epic 9 follow-up, ticket #59)
-- ============================================================================
-- Restaurants switching from another POS/ordering system often have a
-- spreadsheet export of historical sales. This ticket lets an authorized
-- staff member upload a .xlsx/.csv file, preview + map its columns (dish,
-- quantity, date, optional channel) to this tenant's own dishes, and then
-- bulk-import the mapped rows -- reusing ticket #58's `manual_sales_entries`
-- data model, just written in bulk instead of one row at a time. Explicit
-- non-goal (this ticket's own scope): no real order/payment records are ever
-- created here, only additional `manual_sales_entries` rows.
--
-- Two-step flow needs a short-lived server-side staging area between
-- "analyze this file" (parse + return headers/preview/row count) and
-- "commit with this column mapping" (validate + bulk insert), since
-- resubmitting a whole spreadsheet through a single request/hidden form
-- field would risk hitting Next.js's server action body-size limit for any
-- non-trivial import. `sales_import_batches` is that staging area: the
-- server parses the uploaded file once, stores its header row + raw cell
-- data as jsonb here (capped at MAX_IMPORT_ROWS rows, enforced by the
-- application layer as well as the check constraint below), and the confirm
-- step reads it back by id (RLS-scoped, so a batch can never be read or
-- committed by a different tenant) instead of re-parsing anything.
--
-- Deliberately NOT a place real order/payment data ever flows through --
-- `rows` here is only ever raw, not-yet-validated spreadsheet cell text; the
-- only table any of this can ever land in once committed is
-- `manual_sales_entries` (ticket #58), via the exact same validation rules
-- (`packages/domain/src/sales-import/validate-import-rows.ts`, deliberately
-- shared with -- not duplicated from -- that pure logic) enforced again,
-- server-side, at commit time (never trusting a client-supplied "this row is
-- valid" claim from the preview step).
--
-- Permission: reuses ticket #58's `analytics.manualsales.write` -- this is
-- the exact same sensitive action (adding manual_sales_entries rows), just
-- bulked via a file instead of typed one at a time; introducing a second,
-- parallel permission for the same effective capability would only
-- fragment role management without adding any real isolation.
--
-- Retention: `status` moves 'pending' -> 'committed' (rows successfully
-- imported) or 'discarded' (user abandoned the import, or a later cleanup
-- job -- not built in this ticket, see PR's own "unresolved concerns" --
-- reaps stale 'pending' rows past their `expires_at`). A pending batch is a
-- staging artifact, not permanent history, so no historical-immutability
-- rule applies to it the way it would to a committed order.
--
-- Rollback for local/throwaway DBs:
--   drop policy if exists sales_import_batches_select_analytics_read_or_manualsales_write on sales_import_batches;
--   drop policy if exists sales_import_batches_insert_write on sales_import_batches;
--   drop policy if exists sales_import_batches_update_write on sales_import_batches;
--   drop policy if exists sales_import_batches_delete_write on sales_import_batches;
--   drop function if exists purge_expired_sales_import_batches();
--   drop table if exists sales_import_batches;
-- ============================================================================

create table sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  original_filename text not null check (char_length(original_filename) <= 255),
  headers jsonb not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 2000),
  row_count integer not null check (row_count >= 0),
  status text not null default 'pending' check (status in ('pending', 'committed', 'discarded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  committed_at timestamptz
);

comment on table sales_import_batches is
  'Ticket #59: short-lived staging area for an uploaded historical-sales spreadsheet between the analyze (parse + preview) and confirm (validate + bulk-insert into manual_sales_entries) steps. Never itself a source of truth -- rows are raw, unvalidated spreadsheet cell text until commit time, and a batch is discardable/expirable staging data, not permanent history.';

create index sales_import_batches_tenant_status_idx on sales_import_batches (tenant_id, status);

alter table sales_import_batches enable row level security;
grant select, insert, update, delete on sales_import_batches to authenticated;
grant all on sales_import_batches to service_role;

-- Written as four explicit policies rather than via the
-- `apply_basic_tenant_policies()` shared helper (used by most other
-- tenant-scoped admin tables), because SELECT here intentionally deviates
-- from that helper's default (plain tenant membership) -- same reasoning as
-- `manual_sales_entries_select_analytics_read`
-- (20260906120000_manual_sales_entries.sql): a staging batch's raw rows can
-- be joined against `dishes.price_cents` to reconstruct manual-sales figures
-- that a low-privilege tenant member with NEITHER analytics permission
-- should not be able to see.
--
-- Unlike `manual_sales_entries`, SELECT here is not gated on
-- `analytics.read` alone: `analyzeImportFileAction`/`confirmImportAction`
-- (apps/web/src/app/account/menu/import/actions.ts) read a batch back
-- through the caller's OWN session client (subject to this RLS), not a
-- service-role client, so the actor who just staged/is committing a batch
-- must be able to read their own row. That actor is authorized purely via
-- `analytics.manualsales.write` (see the migration header) -- a tenant could
-- grant that permission to a custom role without also granting
-- `analytics.read`, and gating SELECT on `analytics.read` alone would break
-- their own upload preview. SELECT is therefore allowed for either
-- permission, closing the reported gap (plain tenant membership was not
-- enough to read this table) without breaking the legitimate write-only
-- actor's own read-back.
create policy sales_import_batches_select_analytics_read_or_manualsales_write
  on sales_import_batches
  for select
  to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'analytics.read')
    or public.has_tenant_permission(tenant_id, 'analytics.manualsales.write')
  );

create policy sales_import_batches_insert_write
  on sales_import_batches
  for insert
  to authenticated
  with check (public.has_tenant_permission(tenant_id, 'analytics.manualsales.write'));

create policy sales_import_batches_update_write
  on sales_import_batches
  for update
  to authenticated
  using (public.has_tenant_permission(tenant_id, 'analytics.manualsales.write'))
  with check (public.has_tenant_permission(tenant_id, 'analytics.manualsales.write'));

create policy sales_import_batches_delete_write
  on sales_import_batches
  for delete
  to authenticated
  using (public.has_tenant_permission(tenant_id, 'analytics.manualsales.write'));

-- ----------------------------------------------------------------------------
-- purge_expired_sales_import_batches(): on-demand retention purge.
-- ----------------------------------------------------------------------------
-- `expires_at` (default now() + 1 day) otherwise has no cleanup path at
-- all -- nothing ever deletes a stale batch, committed or not, so this
-- table would grow unbounded with raw staged spreadsheet data (up to 2000
-- rows of jsonb each) forever. Mirrors this codebase's existing
-- fixed-window, SECURITY DEFINER, service_role-only on-demand purge shape
-- for other non-historical/staging data (`purge_expired_analytics_events()`,
-- 20260819110000_privacy_export_retention_and_deletion_requests.sql; the
-- equivalent `purge_stale_menu_view_attempts()` for ticket #67's
-- `menu_view_attempts`). Deletes any batch whose `expires_at` has passed
-- regardless of status: a 'pending' batch past its expiry is abandoned
-- staging data with no further use, and a 'committed'/'discarded' batch's
-- raw rows blob has already served its one purpose (import into
-- manual_sales_entries, or nothing) by the time it expires -- neither case
-- is subject to any historical-immutability rule (see migration header).
-- Not yet wired to a scheduled job (this platform has none, same caveat as
-- the two purge functions above) -- exists so an operator/future
-- scheduled-job ticket has a real cleanup path.
create or replace function purge_expired_sales_import_batches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count integer;
begin
  with purged as (
    delete from public.sales_import_batches
     where expires_at < now()
    returning id
  )
  select count(*) into v_deleted_count from purged;

  return v_deleted_count;
end;
$$;

comment on function purge_expired_sales_import_batches() is
  'Ticket #59 review finding: on-demand retention purge for sales_import_batches, which otherwise has no cleanup path -- deletes any batch (any status) past its expires_at. Not yet wired to a scheduled job (this platform has none) -- see docs/security/threat-model.md.';

revoke all on function purge_expired_sales_import_batches() from public;
grant execute on function purge_expired_sales_import_batches() to service_role;

-- ----------------------------------------------------------------------------
-- commit_sales_import_batch(): atomic claim-then-insert (review finding).
-- ----------------------------------------------------------------------------
-- `confirmImportAction` previously read the batch (status = 'pending'),
-- bulk-inserted the caller's already-validated rows into
-- `manual_sales_entries`, and only THEN flipped the batch's status to
-- 'committed' -- three separate round trips. Two concurrent confirms
-- (double-click, a retried request) could both read the same 'pending'
-- batch before either one's status flip landed, and both would then insert
-- their own full set of manual_sales_entries rows -- double-counted sales.
--
-- Fix: the batch is claimed FIRST, atomically, via a single `update ...
-- where status = 'pending' returning id` inside this one function/
-- transaction -- exactly one concurrent caller can ever see a claimed row
-- (Postgres serializes concurrent UPDATEs targeting the same row; the
-- second writer's UPDATE simply matches zero rows once the first has
-- committed the status flip, rather than racing on a separate check-then-act
-- pair of statements the way the old three-round-trip code did). The bulk
-- insert into `manual_sales_entries` only runs if the claim actually
-- affected a row. Row validation itself (dish existence/ownership, quantity/
-- date bounds -- `packages/domain/src/sales-import/validate-import-rows.ts`)
-- still happens in the application layer BEFORE calling this function,
-- exactly as before; only the claim+insert step (the part that actually
-- writes/double-writes data) needed to move into one atomic unit.
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
begin
  perform public.require_tenant_permission(p_tenant_id, 'analytics.manualsales.write');

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

  insert into public.manual_sales_entries
    (tenant_id, dish_id, quantity, sale_date, channel, entered_by_user_id)
  select p_tenant_id,
         (entry ->> 'dishId')::uuid,
         (entry ->> 'quantity')::integer,
         (entry ->> 'saleDate')::date,
         nullif(entry ->> 'channel', ''),
         p_entered_by_user_id
    from jsonb_array_elements(p_entries) as entry;

  get diagnostics v_imported_count = row_count;

  return query select true, v_imported_count;
end;
$$;

comment on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) is
  'Ticket #59 review finding: atomically claims a pending sales_import_batches row (status pending -> committed) and, only if the claim actually affected a row, bulk-inserts the caller''s pre-validated entries into manual_sales_entries -- both in one transaction/function, so two concurrent confirm calls for the same batch can never both insert (the second caller''s claimed = false, imported_count = 0). Enforces analytics.manualsales.write itself via require_tenant_permission.';

revoke all on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) from public;
grant execute on function commit_sales_import_batch(uuid, uuid, jsonb, uuid) to authenticated, service_role;

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
--   drop policy if exists sales_import_batches_select_member on sales_import_batches;
--   drop policy if exists sales_import_batches_insert_write on sales_import_batches;
--   drop policy if exists sales_import_batches_update_write on sales_import_batches;
--   drop policy if exists sales_import_batches_delete_write on sales_import_batches;
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

-- `apply_basic_tenant_policies()` was a transient helper, scoped to and
-- dropped at the end of 20260801110000_restaurant_profile_and_menu_management.sql
-- (see 20260906090000_manual_sales_entries.sql's own recreation of it for the
-- same reason). Recreated here, identical body, then dropped again after use.
create or replace function apply_basic_tenant_policies(p_table regclass, p_write_permission text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('create policy %I on %s for select to authenticated using (public.is_tenant_member(tenant_id))', p_table::text || '_select_member', p_table);
  execute format('create policy %I on %s for insert to authenticated with check (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_insert_write', p_table, p_write_permission);
  execute format('create policy %I on %s for update to authenticated using (public.has_tenant_permission(tenant_id, %L)) with check (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_update_write', p_table, p_write_permission, p_write_permission);
  execute format('create policy %I on %s for delete to authenticated using (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_delete_write', p_table, p_write_permission);
end;
$$;

select apply_basic_tenant_policies('sales_import_batches', 'analytics.manualsales.write');

drop function apply_basic_tenant_policies(regclass, text);

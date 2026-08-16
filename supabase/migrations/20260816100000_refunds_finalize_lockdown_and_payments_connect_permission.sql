-- ============================================================================
-- Epic 7 batch review cycle-3 follow-up fixes (issues #93, #95)
-- ============================================================================
-- Fix 1 (issue #93, medium): `refunds` granted `authenticated` a plain
-- UPDATE, gated only on `payments.refund` -- a payments.refund holder could
-- finalize a refund row directly via PostgREST (set status='failed' on a
-- row that is actually still 'pending' because its own finalize call from
-- `issueRefundForOrder` was lost, releasing a reservation whose real Stripe
-- outcome is unknown). Fix: finalization now only happens through a new
-- service_role SECURITY DEFINER RPC, `finalize_refund()`; the `authenticated`
-- UPDATE grant/policy is dropped entirely. The initial `pending` reservation
-- INSERT is unaffected -- still authenticated, still gated on
-- `payments.refund`, still re-verified by `ensure_refund_matches_payment_and_within_limit()`.
--
-- Fix 2 (issue #95, low but must-fix-before-production): `startStripeOnboardingAction`
-- and the onboarding `refresh_url` page (both create/re-create a Stripe
-- Account Link, i.e. control the payout destination) were gated on the
-- read-shaped `payments.read`, held by Manager. A new Owner-only
-- `payments.connect` permission now gates both -- `payments.read` continues
-- to gate the read-only `return_url` status page and the payments overview
-- page.
--
-- Rollback for local/throwaway DBs:
--   delete from role_permissions where permission_key = 'payments.connect';
--   delete from permissions where key = 'payments.connect';
--   drop function if exists finalize_refund(uuid, text, text);
--   grant update on refunds to authenticated;
--   create policy refunds_update_payments_refund on refunds for update to authenticated
--     using (has_tenant_permission(tenant_id, 'payments.refund'))
--     with check (has_tenant_permission(tenant_id, 'payments.refund'));
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fix 1: service_role-only refund finalization RPC
-- ----------------------------------------------------------------------------
create or replace function finalize_refund(
  p_refund_id uuid,
  p_status text,
  p_stripe_refund_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  if p_status not in ('succeeded', 'failed', 'unconfirmed') then
    raise exception 'finalize_refund: p_status must be one of succeeded, failed, unconfirmed (got %)', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.refunds
     set status = p_status,
         stripe_refund_id = p_stripe_refund_id
   where id = p_refund_id
     and status = 'pending'
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'finalize_refund: refund % not found or not in pending status', p_refund_id
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function finalize_refund(uuid, text, text) is
  'The ONLY code path allowed to transition a refunds row out of pending (issue #93, epic-7 cycle-3 fix): service_role-only, called by refund-service.ts via the admin client after stripe.refunds.create() resolves (or definitively/ambiguously fails). Replaces the previous plain `authenticated` UPDATE, which let any payments.refund holder finalize a row directly via PostgREST -- e.g. flipping a still-pending row (whose own finalize call was lost) to failed and releasing a reservation whose real Stripe outcome is unknown. Raises (does not silently no-op) when the target row does not exist or is not pending, so callers can detect and log a lost/duplicate finalize.';

revoke all on function finalize_refund(uuid, text, text) from public;
grant execute on function finalize_refund(uuid, text, text) to service_role;

drop policy if exists refunds_update_payments_refund on refunds;
revoke update on refunds from authenticated;

comment on table refunds is
  'One row per Stripe refund attempt against a payments row (ticket #26, risk:payment). Multiple partial refunds against the same payment are supported; the running total of pending+succeeded+unconfirmed refunds can never exceed payments.amount_cents, enforced by ensure_refund_matches_payment_and_within_limit(). Only the initial pending reservation is authenticated-writable (INSERT, gated on payments.refund) -- finalization (pending -> succeeded|failed|unconfirmed) is service_role-only via finalize_refund() (issue #93, epic-7 cycle-3 fix).';

-- ----------------------------------------------------------------------------
-- Fix 2: payments.connect permission, Owner-only
-- ----------------------------------------------------------------------------
insert into permissions (key, description)
values ('payments.connect', 'Initiate or refresh Stripe Connect onboarding (controls the tenant''s payout destination)')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as `payments.read` in 20260808130000_stripe_connect_payment_accounts.sql.
-- Deliberately Owner-only, NOT Manager -- unlike payments.read/payments.refund,
-- this permission controls where the tenant's money is paid out to.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'payments.connect'
on conflict do nothing;

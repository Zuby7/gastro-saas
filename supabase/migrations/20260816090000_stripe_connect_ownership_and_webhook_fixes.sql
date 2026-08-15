-- ============================================================================
-- Epic 7 batch review fixes (ticket #23 follow-up, applied on this branch)
-- ============================================================================
-- Fix 1 (HIGH, payout-redirection): `authenticated` previously held INSERT on
-- `payment_accounts` gated only on `payments.read`, and the client, not
-- trusted server code, supplied `stripe_account_id`. A Manager (holds
-- `payments.read` but is not the Owner) could insert a row pointing
-- `stripe_account_id` at an account they control before the real Owner ever
-- connects Stripe; the return_url page's/webhook's service_role write of
-- charges_enabled/payouts_enabled would then trust Stripe's real (accurate)
-- answer for *that* attacker-controlled account, silently redirecting the
-- tenant's future payouts. Fix: remove the `authenticated` INSERT grant and
-- policy entirely -- `payment_accounts` rows are now only ever created by
-- `startStripeOnboardingAction` via the service-role client, immediately
-- after this exact server call created the Stripe Express account for this
-- exact tenant. `stripe_account_id` is therefore never a client-supplied
-- value at any point in its lifecycle.
--
-- Fix 2 (HIGH, webhook retry swallowing): the Connect webhook
-- (`/api/webhooks/stripe-connect`) inserted its dedup row *before*
-- processing, so a genuine mid-processing failure (DB blip, restart) left a
-- claimed-but-unprocessed row that a legitimate Stripe retry of the *same*
-- event id could never reprocess (a plain unique-violation was always read
-- as "already handled"). Fix: `claim_payment_webhook_event()` makes the
-- claim reclaimable -- `insert ... on conflict (stripe_event_id) do update
-- ... where processed_at is null` only "wins" the conflict while the
-- existing row is still unprocessed, so a retry of a row that never reached
-- `processed_at` is treated as claimable (reprocess), while a retry of a
-- truly completed row is a no-op duplicate.
--
-- Fix 3 (low, out-of-order account.updated events): `payment_accounts`
-- gains `last_event_at`, and `apply_connect_account_snapshot()` only applies
-- an incoming snapshot when its Stripe event timestamp is not older than
-- what's already stored -- a delayed/out-of-order older `account.updated`
-- event can no longer clobber newer, better-known status (and, by the same
-- guard, can no longer null out `onboarding_completed_at` after a
-- later-arriving-in-real-time event already set it).
--
-- Rollback for local/throwaway DBs:
--   drop function if exists apply_connect_account_snapshot(text, timestamptz, text, boolean, boolean, text);
--   drop function if exists claim_payment_webhook_event(text, text, text);
--   alter table payment_accounts drop column if exists last_event_at;
--   grant insert on payment_accounts to authenticated;
--   create policy payment_accounts_insert_payments_read on payment_accounts
--     for insert to authenticated with check (has_tenant_permission(tenant_id, 'payments.read'));
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fix 1: remove the client-writable insert path on payment_accounts
-- ----------------------------------------------------------------------------
drop policy if exists payment_accounts_insert_payments_read on payment_accounts;
revoke insert on payment_accounts from authenticated;

comment on table payment_accounts is
  'One Stripe Express connected account per tenant (ticket #23). Onboarding status only -- charge/payout execution is ticket #24/#25. Rows are only ever created by trusted server code (service_role) immediately after it creates the Stripe Express account itself -- `authenticated` holds no INSERT grant, so `stripe_account_id` can never be a client-supplied value (epic-7 batch review fix).';

-- ----------------------------------------------------------------------------
-- Fix 3: out-of-order account.updated guard
-- ----------------------------------------------------------------------------
alter table payment_accounts
  add column if not exists last_event_at timestamptz;

comment on column payment_accounts.last_event_at is
  'Timestamp of the most recent Stripe event (account.updated, or the return_url page''s own synchronous check) applied to this row -- guards against a delayed/out-of-order older event clobbering newer, better-known status. Set via apply_connect_account_snapshot(), never written directly.';

create or replace function apply_connect_account_snapshot(
  p_stripe_account_id text,
  p_event_at timestamptz,
  p_status text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_requirements_summary text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_accounts
     set status = p_status,
         charges_enabled = p_charges_enabled,
         payouts_enabled = p_payouts_enabled,
         requirements_summary = p_requirements_summary,
         onboarding_completed_at = case when p_status = 'enabled' then now() else null end,
         last_event_at = p_event_at
   where stripe_account_id = p_stripe_account_id
     and (last_event_at is null or p_event_at >= last_event_at);
$$;

comment on function apply_connect_account_snapshot(text, timestamptz, text, boolean, boolean, text) is
  'Applies a Stripe account status snapshot to payment_accounts, but only if p_event_at is not older than the last event already applied to this row -- a strictly-older event (e.g. a delayed webhook retry) is silently skipped rather than clobbering newer status. Used by both the account.updated webhook and the return_url page''s own synchronous check (which passes now()).';

revoke all on function apply_connect_account_snapshot(text, timestamptz, text, boolean, boolean, text) from public;
grant execute on function apply_connect_account_snapshot(text, timestamptz, text, boolean, boolean, text) to service_role;

-- ----------------------------------------------------------------------------
-- Fix 2: reclaimable webhook dedup
-- ----------------------------------------------------------------------------
create or replace function claim_payment_webhook_event(
  p_stripe_event_id text,
  p_stripe_account_id text,
  p_event_type text
) returns table (already_processed boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Wins the conflict (claims/re-claims the row) only while the existing
  -- row -- if any -- is still unprocessed. A first-ever delivery inserts a
  -- fresh row (processed_at null); a retry of a row that never finished
  -- processing re-claims it (still processed_at null, update applies); a
  -- retry of a genuinely completed event does not match the `where` clause,
  -- so the conflict resolves as a no-op and the row is left untouched.
  insert into public.payment_webhook_events (stripe_event_id, stripe_account_id, event_type)
  values (p_stripe_event_id, p_stripe_account_id, p_event_type)
  on conflict (stripe_event_id) do update
    set stripe_account_id = excluded.stripe_account_id,
        event_type = excluded.event_type
    where public.payment_webhook_events.processed_at is null;

  return query
  select (payment_webhook_events.processed_at is not null)
    from public.payment_webhook_events
   where payment_webhook_events.stripe_event_id = p_stripe_event_id;
end;
$$;

comment on function claim_payment_webhook_event(text, text, text) is
  'Claims (or re-claims, on retry) a webhook dedup row for processing. Returns already_processed = true only when the event was already durably marked processed_at -- a caller must check this before processing and must call it BEFORE processing, then separately set processed_at only after processing genuinely succeeds (epic-7 batch review fix: a plain unique-violation on insert previously made a claimed-but-never-completed row permanently unreclaimable by Stripe''s own retry).';

revoke all on function claim_payment_webhook_event(text, text, text) from public;
grant execute on function claim_payment_webhook_event(text, text, text) to service_role;

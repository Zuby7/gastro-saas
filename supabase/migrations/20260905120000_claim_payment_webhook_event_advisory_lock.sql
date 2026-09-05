-- ============================================================================
-- Issue #91: claim_payment_webhook_event() -- explicit mutual-exclusion lock
-- ============================================================================
-- `claim_payment_webhook_event()`'s `insert ... on conflict (stripe_event_id)
-- do update ... where processed_at is null` reclaim logic left a narrow
-- window under truly concurrent delivery of the *same* Stripe event: both
-- callers could observe `already_processed = false` before either finished
-- processing, because Postgres's ON CONFLICT resolution alone does not hold
-- a lock across the caller's subsequent processing work -- only across the
-- single insert statement itself. Previously harmless in practice because
-- every downstream consumer this RPC protects (`apply_connect_account_
-- snapshot()`, the order/payment updates in
-- `apps/web/src/app/api/webhooks/stripe/route.ts`) is itself idempotent, but
-- that safety net was implicit, not documented or enforced by a real lock.
--
-- Fix: take an explicit `pg_advisory_xact_lock` keyed on a 64-bit hash of
-- `stripe_event_id` at the top of the function, before the insert/claim. The
-- lock is transaction-scoped (released automatically at commit/rollback of
-- the caller's transaction) and serializes all callers claiming the same
-- event id -- a second concurrent caller for the same event now genuinely
-- blocks until the first caller's transaction (claim + eventual
-- processed_at write, when both happen in the same transaction as the
-- caller intends) completes, rather than racing on ON CONFLICT alone.
-- `hashtextextended` (64-bit) is used instead of `hashtext` (32-bit) to
-- minimize unrelated-event-id lock collisions.
--
-- Rollback for local/throwaway DBs: re-run the CREATE OR REPLACE from
-- 20260816090000_stripe_connect_ownership_and_webhook_fixes.sql (drops the
-- advisory lock, keeps the rest of the function identical).
-- ============================================================================

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
  -- Explicit mutual-exclusion lock (issue #91): serializes all concurrent
  -- callers claiming the same stripe_event_id. Transaction-scoped -- held
  -- until the calling transaction commits or rolls back, so a caller that
  -- claims-and-processes-and-marks-processed_at within a single transaction
  -- gives a truly concurrent second delivery of the same event a real wait,
  -- not just an incidental one.
  perform pg_advisory_xact_lock(hashtextextended(p_stripe_event_id, 0));

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
  'Claims (or re-claims, on retry) a webhook dedup row for processing. Returns already_processed = true only when the event was already durably marked processed_at -- a caller must check this before processing and must call it BEFORE processing, then separately set processed_at only after processing genuinely succeeds. Takes an explicit pg_advisory_xact_lock keyed on stripe_event_id before claiming, so truly concurrent deliveries of the same event are serialized by a real lock rather than relying only on downstream idempotency (issue #91; epic-7 batch review fix for the underlying reclaim logic).';

revoke all on function claim_payment_webhook_event(text, text, text) from public;
grant execute on function claim_payment_webhook_event(text, text, text) to service_role;

-- ============================================================================
-- Issue #92: avoid an orphaned Stripe Express account on a failed DB insert
-- ============================================================================
-- `startStripeOnboardingAction` previously called `stripe.accounts.create()`
-- FIRST and only wrote the `payment_accounts` row afterwards. If that insert
-- failed (DB blip), Stripe already had a real (test-mode) Express account
-- with no local record of it, and a retry created a second orphan instead of
-- reusing the first.
--
-- Fix: `payment_accounts.stripe_account_id` becomes nullable so the server
-- action can pre-create a "provisioning" row (tenant_id + created_by_user_id
-- only, no Stripe account yet) BEFORE calling Stripe, then call
-- `stripe.accounts.create()` with an idempotency key derived from
-- `tenant_id` (this table's primary key -- the natural, already-existing
-- stable per-tenant identifier; no separate generated id column is needed).
-- A retry after a failure anywhere in this sequence lands on the exact same
-- provisioning row and reuses the exact same idempotency key, so Stripe
-- returns the original Express account instead of creating a new one.
--
-- The existing `check (stripe_account_id ~ '^acct_')` constraint already
-- tolerates NULL without modification: a CHECK constraint only rejects rows
-- where the expression evaluates to FALSE, and `NULL ~ '^acct_'` evaluates
-- to NULL (treated as passing), not FALSE. The existing UNIQUE constraint
-- likewise already tolerates multiple NULLs (standard SQL: NULL is never
-- equal to NULL for uniqueness purposes) -- unaffected by this change.
--
-- Rollback for local/throwaway DBs (only safe if no row currently has a NULL
-- stripe_account_id -- backfill or delete provisioning rows first):
--   alter table payment_accounts alter column stripe_account_id set not null;
-- ============================================================================

alter table payment_accounts
  alter column stripe_account_id drop not null;

comment on table payment_accounts is
  'One Stripe Express connected account per tenant (ticket #23). Onboarding status only -- charge/payout execution is ticket #24/#25. Rows are only ever created/updated by trusted server code (service_role) -- `authenticated` holds no INSERT/UPDATE grant, so `stripe_account_id` can never be a client-supplied value (epic-7 batch review fix). `stripe_account_id` may be transiently NULL: `startStripeOnboardingAction` pre-creates a provisioning row before calling Stripe and fills in `stripe_account_id` afterwards, so a retry after a mid-flight failure reuses the same row/idempotency key instead of orphaning a second Stripe Express account (issue #92).';

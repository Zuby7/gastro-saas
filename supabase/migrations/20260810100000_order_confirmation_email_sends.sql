-- ============================================================================
-- Order confirmation emails: email_sends log table (Epic 7, ticket #40)
-- ============================================================================
-- Ticket #40 was added after the Opus architecture review flagged that no
-- prior ticket actually sent the "customer receives a confirmation" MVP
-- acceptance scenario. The send itself is implemented in
-- apps/web/src/lib/notifications/order-confirmation-email.ts, triggered as a
-- best-effort side effect from apps/web/src/lib/payments/webhook-service.ts
-- AFTER the order's `received` transition is already durably committed --
-- see that file's header for why a failed send must never throw/roll back
-- payment processing (`.claude/rules/payments.md`, this ticket's acceptance
-- criterion 2).
--
-- This table is the ticket's own "optional" log (`email_sends`-Protokolltabelle,
-- Status, Zeitstempel, ohne vollständigen Inhalt) -- built now rather than
-- relying on logs alone, since it gives acceptance criterion 3 ("Resend's
-- daily limit produces a VISIBLE error, not a silently-lost email") a
-- queryable, durable trail instead of only ephemeral console output. No email
-- content, no recipient address, no Stripe/provider IDs are stored here --
-- only which tenant/order/email-type/outcome, matching the ticket's own
-- "ohne vollständigen Inhalt" note and this repo's "never log sensitive
-- content" convention (mirrors invitations' email.ts precedent of never
-- logging the raw invite token/URL).
--
-- Follows the tenant_id + RLS pattern established by
-- 20260801040000_tenant_membership_brand_location_model.sql's
-- is_tenant_member(uuid) helper. Not append-only-immutable like audit_logs
-- (this is an operational/observability log, not a security audit trail) --
-- no update/delete is granted to authenticated members regardless, since
-- only the service-role webhook path ever writes it.
--
-- Rollback for local/throwaway DBs:
--   drop policy if exists email_sends_select_member on email_sends;
--   drop table if exists email_sends;
-- ============================================================================

create table email_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid references orders (id) on delete cascade,
  email_type text not null check (email_type in ('order_confirmation', 'order_ready')),
  status text not null check (status in ('sent', 'failed')),
  -- Short, non-sensitive failure reason (e.g. "resend_rate_limited",
  -- "resend_api_error", "no_recipient_email") -- never the email body, never
  -- a stack trace, never a customer address.
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 200),
  created_at timestamptz not null default now()
);

comment on table email_sends is
  'Operational log of transactional email send attempts (ticket #40) -- status/timestamp only, no email content, no recipient address, no provider IDs. Written by the service-role webhook path (apps/web/src/lib/notifications/order-confirmation-email.ts); readable by tenant members for their own tenant.';

create index email_sends_tenant_id_idx on email_sends (tenant_id);
create index email_sends_order_id_idx on email_sends (order_id);
create index email_sends_tenant_id_created_at_idx on email_sends (tenant_id, created_at desc);

alter table email_sends enable row level security;

revoke all on email_sends from public, anon, authenticated;

-- Only the service-role webhook path writes this table -- no INSERT/UPDATE
-- grant for `authenticated` at all.
grant select on email_sends to authenticated;
grant select, insert on email_sends to service_role;
revoke truncate on email_sends from anon, authenticated, service_role;

create policy email_sends_select_member
  on email_sends
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

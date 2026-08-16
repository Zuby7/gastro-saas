-- ============================================================================
-- Ticket #71 (Opus batch review, epic-3-5-batch, cycle 2 finding):
-- inviteMemberAction sent the invitation email BEFORE persisting the
-- invitation row. If create_invitation() failed after an already-sent
-- email (e.g. a transient DB error), the recipient held a legitimate-
-- looking but completely unusable link -- with no audit_logs entry (since
-- create_invitation() never ran) and no rate limit ever applied to the send
-- itself (rate limiting only existed for login/register/checkout, see
-- 20260801060000_auth_onboarding_rpc_and_rate_limiting.sql and
-- 20260804090000_orders_state_machine_and_checkout.sql).
--
-- Fix (the approach the ticket names): persist the invitation FIRST (with a
-- placeholder "not yet confirmed sent" state -- the new nullable
-- `email_sent_at` column), then send the email, then confirm via
-- `mark_invitation_email_sent()`. This guarantees an audit_logs entry
-- (written by create_invitation() itself) exists for every invite attempt
-- that got past the permission check, regardless of whether the email send
-- later succeeds -- and the app-side rate limiter (added in this same
-- ticket, see apps/web/src/app/account/actions.ts) now gates the whole
-- attempt, including the persist, before any email send happens.
--
-- If the email send fails after the invitation is persisted, the row is
-- deliberately NOT deleted: it's a harmless, un-emailed row (nobody holds
-- its raw token, so it cannot be exploited) that documents the attempt via
-- its audit_logs entry, and re-inviting the same email is unaffected (no
-- unique constraint on tenant+email, only on token_hash). A future
-- "resend invitation" feature could use `email_sent_at is null` to find
-- these; implementing that UI is out of this ticket's scope.
-- ============================================================================

alter table invitations
  add column if not exists email_sent_at timestamptz;

comment on column invitations.email_sent_at is
  'Set by mark_invitation_email_sent() once the invitation email has actually been sent. NULL means the invitation row was persisted (and audit-logged) but the email send has not yet been confirmed -- either still in flight or the send failed (ticket #71: invitation persistence now happens before the email send, not after).';

-- ----------------------------------------------------------------------------
-- Confirms a successful email send for an already-persisted invitation.
-- Gated on the same users.invite permission create_invitation() itself
-- requires -- called by the same request that just created the invitation,
-- immediately after its email send succeeds.
-- ----------------------------------------------------------------------------
create or replace function mark_invitation_email_sent(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
    from public.invitations
   where id = p_invitation_id;

  if v_tenant_id is null then
    raise exception 'Invitation not found' using errcode = 'invalid_parameter_value';
  end if;

  perform public.require_tenant_permission(v_tenant_id, 'users.invite');

  update public.invitations
     set email_sent_at = now()
   where id = p_invitation_id;
end;
$$;

comment on function mark_invitation_email_sent(uuid) is
  'Marks a previously-created invitation''s email as sent (ticket #71). Gated on users.invite for the invitation''s own tenant, resolved from the invitation row itself, never from client-supplied tenant context.';

revoke all on function mark_invitation_email_sent(uuid) from public;
grant execute on function mark_invitation_email_sent(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Extends the existing auth rate limiter's scope enum with 'invite' (ticket
-- #71's "rate-limit invitation sending" requirement), reusing the exact
-- same reserve-and-count RPC/table already used for login/register/checkout
-- rather than inventing a second mechanism (same idiom as
-- 20260804090000_orders_state_machine_and_checkout.sql's 'checkout' add).
-- ----------------------------------------------------------------------------
alter table auth_rate_limit_attempts drop constraint if exists auth_rate_limit_attempts_scope_check;
alter table auth_rate_limit_attempts
  add constraint auth_rate_limit_attempts_scope_check check (scope in ('login', 'register', 'checkout', 'invite'));

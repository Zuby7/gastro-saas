"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CreateTenantSchema, InviteMemberSchema } from "@/lib/auth/schemas";
import { sendInvitationEmail } from "@/lib/invitations/email";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations/tokens";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface CreateTenantFormState {
  error?: string;
  fieldErrors?: Partial<Record<"tenantName" | "tenantSlug", string>>;
}

export interface InviteMemberFormState {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<"email" | "roleId", string>>;
}

/**
 * Onboarding-completion fallback (ticket #7 fix cycle 1, item 4/5): lets a
 * logged-in user with zero tenant memberships create their tenant via the
 * same `create_tenant_with_owner` RPC used at registration time, using the
 * *current* authenticated session (the RPC resolves the owner from
 * `auth.uid()`, never a client-supplied id -- see the RPC's own migration
 * comment).
 *
 * Covers two cases that would otherwise be dead ends:
 * - registration's `signUp()` succeeded but `create_tenant_with_owner()`
 *   failed (e.g. a slug conflict), leaving an auth user with no tenant and
 *   no way to complete onboarding via the registration form again (retrying
 *   registration with the same email just reports "already registered");
 * - `auth.email.enable_confirmations = true` (the expected production
 *   posture): registration's `signUp()` returns no session, so
 *   `create_tenant_with_owner()` never ran at signup time at all -- the
 *   user's first login after confirming their email lands here instead.
 */
export async function createTenantAction(
  _prevState: CreateTenantFormState,
  formData: FormData,
): Promise<CreateTenantFormState> {
  const parsed = CreateTenantSchema.safeParse({
    tenantName: formData.get("tenantName"),
    tenantSlug: formData.get("tenantSlug"),
  });

  if (!parsed.success) {
    const fieldErrors: CreateTenantFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        (fieldErrors as Record<string, string>)[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: parsed.data.tenantName,
    p_tenant_slug: parsed.data.tenantSlug,
  });

  if (rpcError) {
    const slugTaken =
      rpcError.code === "23505" || rpcError.message.toLowerCase().includes("duplicate");
    const alreadyHasTenant = rpcError.message.toLowerCase().includes("already belongs to a tenant");

    if (alreadyHasTenant) {
      redirect("/account");
    }

    return {
      error: slugTaken
        ? "Dieser Restaurant-Slug ist bereits vergeben. Bitte wählen Sie einen anderen."
        : "Ihr Restaurant konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
      fieldErrors: slugTaken ? { tenantSlug: "Dieser Slug ist bereits vergeben." } : undefined,
    };
  }

  redirect("/account");
}

export async function inviteMemberAction(
  _prevState: InviteMemberFormState,
  formData: FormData,
): Promise<InviteMemberFormState> {
  const parsed = InviteMemberSchema.safeParse({
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    const fieldErrors: InviteMemberFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        (fieldErrors as Record<string, string>)[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants ( name )")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{ tenant_id: string; tenants: { name: string } | null }>();

  if (membershipError || !membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  // Opus batch review (epic-3-5-batch, high, regression): the users.invite
  // authorization check must happen before anything else this action does
  // (persisting OR emailing) -- it used to live only inside the
  // create_invitation() RPC, which for a while ran *after* the email send,
  // letting any tenant member (even one with no invite permission) trigger
  // an arbitrary invitation email.
  try {
    await requireTenantPermission(supabase, membership.tenant_id, "users.invite");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Sie haben nicht die erforderliche Berechtigung, Mitglieder einzuladen." };
    }
    throw error;
  }

  // Ticket #71 (Opus batch review, epic-3-5-batch, cycle 2): rate-limits
  // invitation sending, reusing the same scope+ip+email fixed-window
  // limiter already used for login/register/checkout (see
  // lib/auth/rate-limit.ts). Keyed by the inviter's IP and the invited
  // email -- this must run before create_invitation() persists anything,
  // so a blocked attempt never touches the DB or sends an email.
  const ip = await getClientIp();
  const admin = createSupabaseAdminClient();
  const rateLimitStore = createSupabaseRateLimitStore(admin);
  const { limited, attemptId } = await reserveAndCheckRateLimit(rateLimitStore, {
    scope: "invite",
    ip,
    email: parsed.data.email,
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  });
  if (limited) {
    return {
      error: "Zu viele Einladungen für diese Adresse. Bitte versuchen Sie es später erneut.",
    };
  }

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const inviteUrl = `${origin}/invite/${token}`;

  // Ticket #71 fix: persist the invitation FIRST (this is also where
  // create_invitation()'s own audit_logs entry is written), THEN send the
  // email, THEN confirm the send via mark_invitation_email_sent(). The
  // previous "send first" design left a real gap: if create_invitation()
  // failed *after* an already-sent email (e.g. a transient DB error), the
  // recipient held a legitimate-looking but completely unusable link, with
  // no audit_logs entry and no rate limit ever applied to the send itself.
  // Persisting first closes that gap -- every invite attempt that gets past
  // the permission + rate-limit checks above is now audit-logged and
  // rate-limit-counted regardless of whether the email send that follows
  // succeeds. If the email send below fails, the invitation row is
  // deliberately left in place with `email_sent_at` still null rather than
  // deleted: nobody holds its raw token (only the hash is stored), so it
  // cannot be exploited, and re-inviting the same email is unaffected (no
  // unique constraint on tenant+email).
  const { data: invitationId, error: rpcError } = await supabase.rpc("create_invitation", {
    p_tenant_id: membership.tenant_id,
    p_email: parsed.data.email,
    p_role_id: parsed.data.roleId,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (rpcError) {
    return {
      error: "Die Einladung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    };
  }

  try {
    await sendInvitationEmail({
      to: parsed.data.email,
      inviteUrl,
      tenantName: membership.tenants?.name ?? "Ihrem Restaurant",
    });
  } catch {
    return {
      error:
        "Die Einladung wurde gespeichert, aber die E-Mail konnte nicht versendet werden. Bitte versuchen Sie es erneut.",
    };
  }

  await supabase.rpc("mark_invitation_email_sent", { p_invitation_id: invitationId });
  await rateLimitStore.markSucceeded(attemptId);

  return { success: "Einladung wurde erstellt und versendet." };
}

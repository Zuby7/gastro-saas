"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { createStripeClient } from "@/lib/stripe/client";
import { createExpressAccount, createOnboardingAccountLink } from "@/lib/stripe/connect";

export interface PaymentsOnboardingFormState {
  error?: string;
}

/**
 * Ticket #23: creates the tenant's Stripe Express connected account (if it
 * doesn't exist yet) and redirects to a freshly generated, Stripe-hosted
 * Account Link. Never handles verification documents itself -- Stripe's
 * hosted onboarding does that. Gated server-side on the Owner-only
 * `payments.connect` permission (issue #95 -- this action controls the
 * tenant's payout destination, a more sensitive action than the read-shaped
 * `payments.read` it was previously gated on; RLS enforces the
 * `payment_accounts` writes below independently, at the service-role layer).
 */
export async function startStripeOnboardingAction(
  _prevState: PaymentsOnboardingFormState,
  _formData: FormData,
): Promise<PaymentsOnboardingFormState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.connect");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, das Stripe-Konto zu verbinden.",
      };
    }
    throw error;
  }

  const { data: existing } = await supabase
    .from("payment_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<{ stripe_account_id: string }>();

  const stripe = createStripeClient();
  let accountId = existing?.stripe_account_id ?? null;

  if (!accountId) {
    // Written through the service-role admin client, never the caller's own
    // session client: `payment_accounts` intentionally grants `authenticated`
    // no INSERT/UPDATE at all (see the migrations) -- `stripe_account_id`
    // must only ever be a value this server itself just received from
    // Stripe for this exact tenant, never a value the client could choose
    // (epic-7 batch review fix -- previously a Manager could insert a row
    // pointing at an account they controlled and redirect the tenant's
    // payouts).
    const admin = createSupabaseAdminClient();

    // Phase 1 (issue #92): pre-create a provisioning row -- tenant_id +
    // created_by_user_id only, `stripe_account_id` still NULL -- BEFORE
    // calling Stripe. `ignoreDuplicates` makes this a no-op on a retry
    // (the row from a previous, failed attempt already exists). Without
    // this row existing first, a retry after phase 3 fails below would have
    // no stable identifier to derive an idempotency key from and would call
    // Stripe with a fresh key, creating a second orphaned account.
    const { error: provisionError } = await admin.from("payment_accounts").upsert(
      { tenant_id: membership.tenantId, created_by_user_id: user.id },
      { onConflict: "tenant_id", ignoreDuplicates: true },
    );

    if (provisionError) {
      return {
        error: "Das Stripe-Konto konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
      };
    }

    // Phase 2: create (or, on retry, idempotently re-fetch) the Stripe
    // Express account. The idempotency key is derived from `tenant_id` --
    // this table's primary key and the provisioning row's stable identifier
    // -- so a retry after phase 3 fails below reuses the exact same Stripe
    // account instead of orphaning a new one.
    const account = await createExpressAccount(
      stripe,
      { tenantId: membership.tenantId, email: user.email },
      { idempotencyKey: `stripe-express-account:${membership.tenantId}` },
    );
    accountId = account.id;

    // Phase 3: record the now-real Stripe account id on the provisioning
    // row created in phase 1.
    const { error: updateError } = await admin
      .from("payment_accounts")
      .update({ stripe_account_id: accountId })
      .eq("tenant_id", membership.tenantId);

    if (updateError) {
      return {
        error: "Das Stripe-Konto konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
      };
    }

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: membership.tenantId,
      actorUserId: user.id,
      action: "payment_account.connect_started",
      targetType: "payment_account",
      targetId: membership.tenantId,
    });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const accountLink = await createOnboardingAccountLink(stripe, {
    accountId,
    returnUrl: `${origin}/account/payments/return`,
    refreshUrl: `${origin}/account/payments/refresh`,
  });

  redirect(accountLink.url);
}

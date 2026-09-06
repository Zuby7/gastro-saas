import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { createStripeClient } from "@/lib/stripe/client";
import { retrieveAccount, summarizeAccount } from "@/lib/stripe/connect";

/**
 * Ticket #23: Stripe's hosted onboarding `return_url` target. Stripe
 * redirects here once the owner finishes (or abandons) the hosted flow, but
 * does not guarantee the account is fully verified by that point -- so this
 * page synchronously re-fetches the account from Stripe (Retrieve Account)
 * and updates `payment_accounts` before showing the live status. The
 * `account.updated` webhook (`/api/webhooks/stripe-connect`) keeps status
 * in sync in the background afterwards even if the owner never returns.
 */
export default async function PaymentsReturnPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      redirect("/account/payments");
    }
    throw error;
  }

  const { data: existing } = await supabase
    .from("payment_accounts")
    .select("stripe_account_id, status")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<{ stripe_account_id: string; status: string }>();

  if (existing) {
    const stripe = createStripeClient();
    const account = await retrieveAccount(stripe, existing.stripe_account_id);
    const snapshot = summarizeAccount(account);

    // Written through the service-role admin client, never the caller's own
    // session client: `payment_accounts` intentionally grants `authenticated`
    // no UPDATE at all (see the migration) -- these status columns must only
    // ever reflect what Stripe itself just reported, not a value the tenant
    // member's own session could set directly. Tenant scope (`membership.tenantId`)
    // was already resolved server-side above from the caller's own session,
    // never from client input.
    //
    // Goes through `apply_connect_account_snapshot()` (not a plain update)
    // with `p_event_at = now()`: this is a fresh, synchronous Retrieve
    // Account call, so it is definitionally at least as current as any
    // `account.updated` webhook event applied so far -- this also keeps a
    // subsequent delayed/out-of-order webhook event from clobbering the
    // status this page just verified (epic-7 batch review fix).
    const admin = createSupabaseAdminClient();
    await admin.rpc("apply_connect_account_snapshot", {
      p_stripe_account_id: existing.stripe_account_id,
      p_event_at: new Date().toISOString(),
      p_status: snapshot.status,
      p_charges_enabled: snapshot.chargesEnabled,
      p_payouts_enabled: snapshot.payoutsEnabled,
      p_requirements_summary: snapshot.requirementsSummary,
    });

    if (snapshot.status !== existing.status) {
      await recordMenuAdminAuditEvent(supabase, {
        tenantId: membership.tenantId,
        actorUserId: user.id,
        action: "payment_account.status_changed",
        targetType: "payment_account",
        targetId: membership.tenantId,
        metadata: { from: existing.status, to: snapshot.status },
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        Stripe-Onboarding abgeschlossen
      </h1>
      <p className="text-sm text-foreground">Der aktuelle Verbindungsstatus wurde aktualisiert.</p>
      <Link
        href="/account/payments"
        className="font-medium text-link-foreground underline hover:text-brand-700"
      >
        Zum Zahlungsstatus
      </Link>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { ensureMockIntegrationAccount, listIntegrationSyncJobs } from "@/lib/integrations/service";
import { IntegrationsPanel } from "./integrations-panel";

/**
 * Admin integrations overview (Epic 12, ticket #38). Gated on
 * `integrations.manage` (both here, server-side, and independently
 * re-checked by every RPC `service.ts` calls). Mirrors the reviews
 * moderation page's structure (`apps/web/src/app/account/reviews/page.tsx`,
 * ticket #34).
 */
export default async function IntegrationsPage() {
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
    await requireTenantPermission(supabase, membership.tenantId, "integrations.manage");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um Integrationen zu verwalten.
          </p>
          <Link
            href="/account"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const account = await ensureMockIntegrationAccount(supabase, membership.tenantId);
  const jobs = await listIntegrationSyncJobs(supabase, membership.tenantId, account.id);

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">Integrationen</h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <IntegrationsPanel initialAccount={account} initialJobs={jobs} />
      </div>
    </main>
  );
}

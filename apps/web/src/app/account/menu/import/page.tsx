import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { SalesImportClient } from "./sales-import-client";

/**
 * Ticket #59 ("Excel-Import für historische Verkaufsdaten"): admin page for
 * bulk-importing historical sales from a .xlsx/.csv export of another
 * POS/ordering system. Gated on the same `analytics.manualsales.write`
 * permission as ticket #58's per-dish manual entry form -- this is the same
 * sensitive capability (adding `manual_sales_entries` rows), just bulked.
 */
export default async function SalesImportPage() {
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
    await requireTenantPermission(supabase, membership.tenantId, "analytics.manualsales.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, Verkaufsdaten zu importieren.
          </p>
          <Link
            href="/account/menu"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Verkaufsdaten importieren
          </h1>
          <Link
            href="/account/menu"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Speisekarte
          </Link>
        </div>

        <SalesImportClient />
      </div>
    </main>
  );
}

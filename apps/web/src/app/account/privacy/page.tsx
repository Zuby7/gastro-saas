import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PermissionDeniedError,
  hasTenantPermission,
  requireTenantPermission,
} from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { RetentionSettingsForm } from "./retention-settings-form";
import { DeletionRequestForm } from "./deletion-request-form";

interface RetentionSettingsRow {
  analytics_events_retention_days: number;
}

interface DeletionRequestRow {
  id: string;
  status: string;
  requested_at: string;
  processed_at: string | null;
  retained_orders_count: number | null;
  anonymized_orders_count: number | null;
  analytics_events_purged_count: number | null;
}

/**
 * Ticket #36 (risk:privacy): tenant data export + deletion-request +
 * retention-configuration settings surface. Gated server-side on
 * `tenant.settings.write` for the page itself (export + retention config);
 * the deletion-request section additionally requires the Owner-only
 * `tenant.data.delete` permission and is hidden (not just disabled) for
 * anyone without it -- UI hiding is never itself the authorization boundary,
 * both server actions and the underlying RPCs re-check permissions
 * independently.
 */
export default async function PrivacyPage() {
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
    await requireTenantPermission(supabase, membership.tenantId, "tenant.settings.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-neutral-50 p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um Datenschutz-Einstellungen zu sehen.
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

  const canRequestDeletion = await hasTenantPermission(
    supabase,
    membership.tenantId,
    "tenant.data.delete",
  );

  const { data: retentionSettings } = await supabase
    .from("privacy_retention_settings")
    .select("analytics_events_retention_days")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<RetentionSettingsRow>();

  const { data: deletionRequests } = canRequestDeletion
    ? await supabase
        .from("data_deletion_requests")
        .select(
          "id, status, requested_at, processed_at, retained_orders_count, anonymized_orders_count, analytics_events_purged_count",
        )
        .eq("tenant_id", membership.tenantId)
        .order("requested_at", { ascending: false })
        .returns<DeletionRequestRow[]>()
    : { data: [] as DeletionRequestRow[] };

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">Datenschutz</h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Tenant-Datenexport</h2>
          <p className="text-sm text-foreground">
            Exportiert die wesentlichen Tenant-Daten (Profil, Öffnungszeiten, Team, Speisekarte,
            Bestellungen, Zahlungen) als JSON-Datei.
          </p>
          <a
            href="/api/account/privacy/export"
            className="w-fit rounded-md border border-neutral-300 px-4 py-2 font-medium text-foreground hover:bg-neutral-100"
          >
            Daten exportieren
          </a>
        </section>

        <RetentionSettingsForm
          initialRetentionDays={retentionSettings?.analytics_events_retention_days ?? 365}
        />

        {canRequestDeletion ? (
          <>
            <DeletionRequestForm />

            {deletionRequests && deletionRequests.length > 0 ? (
              <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground">Bisherige Löschanträge</h2>
                <ul className="flex flex-col gap-2 text-sm text-foreground">
                  {deletionRequests.map((request) => (
                    <li key={request.id} className="rounded-md border border-neutral-200 p-3">
                      <div>
                        Status: <strong>{request.status}</strong> (
                        {new Date(request.requested_at).toLocaleString("de-DE")})
                      </div>
                      {request.status === "completed" ? (
                        <div className="text-neutral-600">
                          Erhalten (Aufbewahrungsfrist): {request.retained_orders_count ?? 0}{" "}
                          Bestellungen · Anonymisiert: {request.anonymized_orders_count ?? 0}{" "}
                          Bestellungen · Gelöscht: {request.analytics_events_purged_count ?? 0}{" "}
                          Analytics-Events
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

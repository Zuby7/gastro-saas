"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import {
  IntegrationDomainError,
  ensureMockIntegrationAccount,
  runMockMenuExport,
  runMockSimulatedOrder,
} from "@/lib/integrations/service";
import type { IntegrationSyncJobView } from "@/lib/integrations/types";

export interface IntegrationActionResult {
  error?: string;
  jobs?: IntegrationSyncJobView[];
}

/**
 * Resolves the caller's own tenant id + slug from their session membership
 * (never a client-supplied value, per `.claude/rules/tenant-isolation.md`)
 * and gates on `integrations.manage` -- both here and independently
 * re-checked by every RPC `service.ts` calls (two enforcement layers).
 */
async function resolveAuthorizedTenant(): Promise<
  | { error: string }
  | { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; tenantId: string; tenantSlug: string }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sie sind nicht angemeldet." };
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "integrations.manage");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, Integrationen zu verwalten.",
      };
    }
    throw error;
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", membership.tenantId)
    .maybeSingle<{ slug: string }>();

  if (!tenant) {
    return { error: "Restaurant konnte nicht gefunden werden." };
  }

  return { supabase, tenantId: membership.tenantId, tenantSlug: tenant.slug };
}

/** Triggers the mock provider's menu export (ticket #38 acceptance criterion 1). */
export async function exportMenuAction(): Promise<IntegrationActionResult> {
  const resolved = await resolveAuthorizedTenant();
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const { supabase, tenantId, tenantSlug } = resolved;

  try {
    const account = await ensureMockIntegrationAccount(supabase, tenantId);
    const job = await runMockMenuExport(supabase, {
      tenantId,
      tenantSlug,
      integrationAccountId: account.id,
    });
    revalidatePath("/account/integrations");
    return { jobs: [job] };
  } catch (error) {
    if (error instanceof IntegrationDomainError) {
      return { error: error.message };
    }
    return { error: "Der Menü-Export konnte nicht durchgeführt werden. Bitte versuchen Sie es erneut." };
  }
}

/** Triggers a simulated incoming order + its confirmation (ticket #38 acceptance criterion 1). */
export async function simulateIncomingOrderAction(): Promise<IntegrationActionResult> {
  const resolved = await resolveAuthorizedTenant();
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const { supabase, tenantId, tenantSlug } = resolved;

  try {
    const account = await ensureMockIntegrationAccount(supabase, tenantId);
    const { importJob, confirmationJob } = await runMockSimulatedOrder(supabase, {
      tenantId,
      tenantSlug,
      integrationAccountId: account.id,
    });
    revalidatePath("/account/integrations");
    return { jobs: [importJob, confirmationJob] };
  } catch (error) {
    if (error instanceof IntegrationDomainError) {
      return { error: error.message };
    }
    return {
      error: "Der simulierte Bestelleingang konnte nicht ausgelöst werden. Bitte versuchen Sie es erneut.",
    };
  }
}

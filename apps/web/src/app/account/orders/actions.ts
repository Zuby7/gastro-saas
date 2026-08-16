"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import {
  listTenantOrdersForDashboard,
  type ListTenantOrdersForDashboardResult,
} from "@/lib/orders/dashboard-service";

/**
 * Polled by the client-side `OrderBoard` component (see `./order-board.tsx`)
 * to keep the staff order dashboard live without any realtime infrastructure
 * -- mirrors `apps/web/src/app/r/[slug]/orders/[token]/actions.ts`'s
 * `pollOrderStatus` precedent.
 *
 * Deliberately takes no `tenantId` parameter: tenant context is always
 * re-resolved here from the caller's own session membership
 * (`getCurrentMembership`), never trusted from the client, even though the
 * client already knows which tenant it's polling for -- this repo's
 * tenant-isolation rule ("tenant context comes only from the authenticated
 * session's membership record, never a client-supplied ID"). Returns `null`
 * for "not authenticated" / "no membership" / "missing orders.read" alike so
 * the client can't distinguish those cases and stops polling either way.
 */
export async function pollTenantOrders(
  limit?: number,
): Promise<ListTenantOrdersForDashboardResult | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return null;
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "orders.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return null;
    }
    throw error;
  }

  return listTenantOrdersForDashboard(supabase, { tenantId: membership.tenantId, limit });
}

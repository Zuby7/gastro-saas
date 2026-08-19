import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";

/**
 * Ticket #36: tenant data export. Downloads the tenant's own operational
 * data (profile, opening hours, team, basic menu, orders/items, payments,
 * retention settings, deletion-request history) as a single JSON file.
 *
 * Two enforcement layers, per this repo's standard: `requireTenantPermission`
 * here, AND `export_tenant_data()`'s own internal
 * `require_tenant_permission()` re-check (RLS itself does not apply -- the
 * function is SECURITY DEFINER and filters every referenced table by
 * `p_tenant_id` explicitly, mirroring `get_tenant_order_payment_statuses()`'s
 * precedent). Tenant context is always resolved from the caller's own
 * membership row, never from a client-supplied id.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "tenant.settings.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw error;
  }

  const { data, error } = await supabase.rpc("export_tenant_data", {
    p_tenant_id: membership.tenantId,
  });

  if (error) {
    return new NextResponse("Der Export konnte nicht erstellt werden.", { status: 500 });
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId: membership.tenantId,
    actorUserId: user.id,
    action: "privacy.export.completed",
    targetType: "tenant",
    targetId: membership.tenantId,
  });

  const timestamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tenant-export-${timestamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

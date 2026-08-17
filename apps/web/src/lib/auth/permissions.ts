import type { SupabaseClient } from "@supabase/supabase-js";

export type PermissionKey =
  | "users.invite"
  | "users.manage"
  | "roles.manage"
  | "tenant.settings.write"
  | "menu.write"
  | "menu.publish"
  | "orders.cancel"
  | "orders.read"
  | "orders.manage"
  | "payments.read"
  | "payments.refund"
  | "payments.connect"
  | "analytics.read"
  | "audit.read";

export class PermissionDeniedError extends Error {
  constructor(
    readonly tenantId: string,
    readonly permission: PermissionKey,
  ) {
    super("Sie haben nicht die erforderliche Berechtigung.");
    this.name = "PermissionDeniedError";
  }
}

/**
 * Server-side permission gate for tenant-scoped reads/mutations. The database
 * function resolves the actor from auth.uid(); callers must never trust a
 * client-supplied tenant_id without first resolving it from the user's session.
 */
export async function requireTenantPermission(
  supabase: SupabaseClient,
  tenantId: string,
  permission: PermissionKey,
): Promise<void> {
  const { error } = await supabase.rpc("require_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_key: permission,
  });

  if (error) {
    throw new PermissionDeniedError(tenantId, permission);
  }
}

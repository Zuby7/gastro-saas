import type { SupabaseClient } from "@supabase/supabase-js";

export type PermissionKey =
  | "users.invite"
  | "users.manage"
  | "roles.manage"
  | "tenant.settings.write"
  | "menu.write"
  | "menu.publish"
  | "menu.availability.manage"
  | "orders.cancel"
  | "orders.read"
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

/**
 * Non-throwing permission check, for UI gating decisions (e.g. "show the
 * availability toggle") where a denial is an expected, silent case rather
 * than an error path -- unlike `requireTenantPermission`, which is for
 * mutation/read gates that should hard-fail. This is never itself an
 * authorization check: any mutation this informs still calls
 * `requireTenantPermission` (or an RPC that does so server-side) before
 * writing.
 *
 * Also used (Epic 8 Opus batch review, finding 7) where a missing permission
 * should narrow a response rather than deny the whole request -- e.g. the
 * staff order dashboard, which every `orders.read` holder (including
 * Kitchen/Service) may view, but only a `payments.read` holder should see
 * revenue figures within.
 */
export async function hasTenantPermission(
  supabase: SupabaseClient,
  tenantId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_key: permission,
  });

  if (error) {
    return false;
  }
  return Boolean(data);
}

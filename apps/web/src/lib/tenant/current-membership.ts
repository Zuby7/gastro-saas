import type { SupabaseClient } from "@supabase/supabase-js";

export interface CurrentMembership {
  tenantId: string;
  role: string;
}

/**
 * Resolves the calling user's tenant membership (first one, matching the
 * single-tenant-per-user assumption already used by `/account`). Tenant
 * context is always derived from this server-side lookup against the
 * authenticated session's own membership row -- never from a client-supplied
 * tenant id (`.claude/rules/tenant-isolation.md`).
 */
export async function getCurrentMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<CurrentMembership | null> {
  const { data } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ tenant_id: string; role: string }>();

  if (!data) {
    return null;
  }

  return { tenantId: data.tenant_id, role: data.role };
}

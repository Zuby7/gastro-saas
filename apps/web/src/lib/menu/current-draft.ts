import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Get-or-create the tenant's current draft menu version via the
 * `create_initial_draft_menu_version` RPC (see
 * `supabase/migrations/20260802090000_menu_admin_ui_support.sql`). The RPC
 * itself enforces `menu.write` and resolves `p_tenant_id` only against a
 * value the caller already derived from the authenticated session's own
 * membership -- never a client-supplied value.
 */
export async function getOrCreateDraftMenuVersionId(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_initial_draft_menu_version", {
    p_tenant_id: tenantId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Der Entwurf konnte nicht geladen werden.");
  }

  return data as string;
}

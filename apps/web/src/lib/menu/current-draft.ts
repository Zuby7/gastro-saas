import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Get-or-create the tenant's current draft menu version via the
 * `create_initial_draft_menu_version` RPC (see
 * `supabase/migrations/20260802090000_menu_admin_ui_support.sql`). The RPC
 * itself enforces `menu.write` and resolves `p_tenant_id` only against a
 * value the caller already derived from the authenticated session's own
 * membership -- never a client-supplied value.
 *
 * Called as a side effect of `MenuPage`'s server-render (a GET), which is
 * what let the Opus cycle-3 review reproduce the get-or-create race in
 * practice (two concurrent page loads for the same tenant). Deliberately
 * left as a render-time call rather than moved behind an explicit
 * first-edit action: the RPC itself is now concurrency-safe (see its
 * `pg_advisory_xact_lock`, keyed on tenant_id, taken before the
 * get-or-create SELECT), so calling it on every render is safe -- it is
 * still get-or-create, just race-free -- and keeping it here avoids adding
 * a second "no draft yet" UI state that every mutation action would need to
 * handle.
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

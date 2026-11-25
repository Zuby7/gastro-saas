import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a tenant already uses this web address. Server-only: takes the
 * service-role client because an unauthenticated registrant cannot read
 * `tenants` through RLS, and returns nothing but a boolean (slugs are public
 * anyway through `/r/<slug>`). A failing lookup answers `false`: the unique
 * constraint inside `create_tenant_with_owner` remains the authoritative
 * guard, this check only exists to fail early and recoverably.
 */
export async function isTenantSlugTaken(admin: SupabaseClient, slug: string): Promise<boolean> {
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    return false;
  }
  return data !== null;
}

import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentMembership, type CurrentMembership } from "@/lib/tenant/current-membership";

export interface AccountContext {
  supabase: SupabaseClient;
  /** Validated against the Auth server (`getUser()`), `null` when signed out. */
  user: User | null;
  /** The user's own tenant membership, `null` when signed out or without one. */
  membership: CurrentMembership | null;
}

/**
 * Per-request shared session context for the `/account` Server Components:
 * Supabase client, authenticated user and tenant membership, resolved once
 * (React `cache()`) instead of once per component that needs them. The
 * tenant always comes from the session's own membership row, never from a
 * client-supplied value.
 *
 * This only deduplicates the lookups. Callers still own the redirects
 * (`!user` -> /login, `!membership` -> /account) and still call
 * `requireTenantPermission` themselves before reading or rendering anything
 * tenant data related: a cached context is never an authorization decision.
 */
export const getAccountContext = cache(async (): Promise<AccountContext> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, membership: null };
  }

  const membership = await getCurrentMembership(supabase, user.id);
  return { supabase, user, membership };
});

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client -- bypasses RLS entirely. Server-side only:
 * never import this module from a Client Component, never send
 * `SUPABASE_SERVICE_ROLE_KEY` to the browser (CLAUDE.md "no secrets in the
 * browser" rule).
 *
 * Used for:
 * - the auth rate limiter (`lib/auth/supabase-rate-limit-store.ts`), which
 *   must run *before* any user session exists (e.g. for a login attempt
 *   against a wrong password, there is no authenticated session at all);
 * - other trusted server-side operations that must not depend on the
 *   caller's own RLS visibility.
 *
 * Never used to resolve tenant context from client input -- tenant context
 * always comes from the authenticated session (`lib/supabase/server.ts`),
 * never from this client.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to create the Supabase admin client.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

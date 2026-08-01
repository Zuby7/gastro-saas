import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Session-aware Supabase client for Server Components/Server Actions/Route
 * Handlers. Reads/writes the session via httpOnly cookies (`@supabase/ssr`) --
 * no token ever touches `localStorage` or client-side JS, per
 * `docs/security/tenant-isolation.md`/CLAUDE.md's "no secrets in the
 * browser" rule. Every RPC/query made through this client is subject to RLS
 * for the calling user's own session -- it never bypasses it.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `cookies()` in a Server Component render is read-only -- this
            // throw is expected there and is harmless because
            // `apps/web/src/middleware.ts` refreshes/re-writes the session
            // cookie on every request instead. Only Server Actions/Route
            // Handlers actually need to (and can) write cookies here.
          }
        },
      },
    },
  );
}

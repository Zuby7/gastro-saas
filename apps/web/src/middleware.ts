import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { menuViewCookieName } from "@/lib/menu-view/cookie-name";

// Matches only the base public menu route (`/r/<slug>`), not its
// cart/checkout/order-status sub-routes -- ticket #67's menu-view analytics
// cookie only needs to exist where `recordMenuViewOnce` is actually called
// (apps/web/src/app/r/[slug]/page.tsx), so minting is kept as narrow as
// possible.
const PUBLIC_MENU_ROUTE_PATTERN = /^\/r\/([^/]+)\/?$/;

const MENU_VIEW_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours -- short-lived/ephemeral by design (ticket #67)

// `menuViewCookieName` itself lives in `@/lib/menu-view/cookie-name` (no
// `next/headers` import there), shared with
// `apps/web/src/lib/menu-view/cookie.ts` which reads this same cookie from a
// Server Component -- previously each duplicated the sanitizing regex
// independently, which risked the two copies drifting apart and letting
// distinct slugs collide on the same cookie name (Opus finding, PR #129).

/**
 * Refreshes the Supabase session cookie on every request. Required because
 * Server Components can read cookies but cannot write them -- without this,
 * a rotated/refreshed auth token would never make it back into the
 * `httpOnly` cookie, and sessions would silently expire mid-visit. Matches
 * `@supabase/ssr`'s documented Next.js App Router middleware pattern.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // `getUser()` (not `getSession()`) validates the token against the Auth
  // server rather than trusting the locally-decoded JWT, and as a side
  // effect refreshes/rotates the session cookie via the `setAll` above.
  await supabase.auth.getUser();

  // Ticket #67: mint an opaque, ephemeral, anonymous menu-view session
  // cookie for the base public menu route, if one doesn't already exist --
  // Server Components (apps/web/src/app/r/[slug]/page.tsx) can read cookies
  // but cannot write them, so minting must happen here, mirroring the
  // Supabase session-cookie refresh above. The raw token never reaches
  // Postgres (only its SHA-256 hash does, via
  // apps/web/src/lib/menu-view/service.ts) and this cookie is never trusted
  // as a tenant id -- tenant_id is always re-resolved server-side from the
  // route slug.
  const menuRouteMatch = PUBLIC_MENU_ROUTE_PATTERN.exec(request.nextUrl.pathname);
  if (menuRouteMatch) {
    const tenantSlug = menuRouteMatch[1]!;
    const cookieName = menuViewCookieName(tenantSlug);
    if (!request.cookies.get(cookieName)) {
      const token = randomBytes(32).toString("base64url");
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: MENU_VIEW_COOKIE_MAX_AGE_SECONDS,
      };
      // Set on `request` (so this same request's Server Component can read
      // it via `cookies()` -- Server Components see the incoming request's
      // cookies, not the outgoing response's) *before* rebuilding
      // `response` from the updated request, exactly mirroring the
      // Supabase `setAll` callback above. Any Set-Cookie headers the
      // Supabase callback already applied to the previous `response` are
      // preserved explicitly (`NextResponse.next({ request })` returns a
      // fresh response with no cookies of its own) so they aren't lost by
      // this reassignment.
      const previousSetCookies = response.cookies.getAll();
      request.cookies.set(cookieName, token);
      response = NextResponse.next({ request });
      for (const cookie of previousSetCookies) {
        response.cookies.set(cookie);
      }
      response.cookies.set(cookieName, token, cookieOptions);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

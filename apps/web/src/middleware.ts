import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { MENU_VIEW_COOKIE_PREFIX, menuViewCookieName } from "@/lib/menu-view/cookie-name";
import { CONSENT_COOKIE_NAME, hasStatisticsConsent } from "@/lib/consent/cookie";
import { createOpaqueToken } from "@/lib/security/opaque-token";

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

// Routes whose Server Components / route handlers read the Supabase session
// (verified by grep for createSupabaseServerClient/getUser/getCurrentMembership:
// account area, login, register, invite acceptance, /api/account/*, /api/qr).
// Only these pay for the Auth-server round trip of `getUser()`.
const SESSION_ROUTE_PREFIXES = [
  "/account",
  "/login",
  "/register",
  "/invite",
  "/api/account",
  "/api/qr",
];

// Public menu routes (`/r/*`) read the session only through
// `getPublicMenu`'s server client, and only matter for a visitor who already
// has a Supabase auth cookie (e.g. staff previewing their own menu); anonymous
// guests, the vast majority, skip the refresh entirely.
const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(\.\d+)?$/;

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function needsSessionRefresh(pathname: string, hasAuthCookie: boolean): boolean {
  if (SESSION_ROUTE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return true;
  }
  return hasAuthCookie && pathMatchesPrefix(pathname, "/r");
}

/**
 * Refreshes the Supabase session cookie on the routes that read a session
 * (see `needsSessionRefresh`). Required because Server Components can read
 * cookies but cannot write them -- without this, a rotated/refreshed auth
 * token would never make it back into the `httpOnly` cookie, and sessions
 * would silently expire mid-visit. Matches `@supabase/ssr`'s documented
 * Next.js App Router middleware pattern. `/media`, `/api/webhooks`,
 * `/landing` and static files are excluded by `config.matcher` below.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // `NextResponse.next({ request })` returns a fresh response with no
  // cookies of its own, so every rebuild must carry over the Set-Cookie
  // headers already applied to the previous one.
  const rebuildResponse = (mutateRequest: () => void) => {
    const previousSetCookies = response.cookies.getAll();
    mutateRequest();
    response = NextResponse.next({ request });
    for (const cookie of previousSetCookies) {
      response.cookies.set(cookie);
    }
  };

  const hasAuthCookie = request.cookies
    .getAll()
    .some((cookie) => SUPABASE_AUTH_COOKIE_PATTERN.test(cookie.name));

  if (needsSessionRefresh(request.nextUrl.pathname, hasAuthCookie)) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            rebuildResponse(() => {
              for (const { name, value } of cookiesToSet) {
                request.cookies.set(name, value);
              }
            });
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
  }

  // Ticket #67: mint an opaque, ephemeral, anonymous menu-view session
  // cookie for the base public menu route, if one doesn't already exist --
  // Server Components (apps/web/src/app/r/[slug]/page.tsx) can read cookies
  // but cannot write them, so minting must happen here, mirroring the
  // Supabase session-cookie refresh above. The raw token never reaches
  // Postgres (only its SHA-256 hash does, via
  // apps/web/src/lib/menu-view/service.ts) and this cookie is never trusted
  // as a tenant id -- tenant_id is always re-resolved server-side from the
  // route slug.
  //
  // Ticket #146: this cookie is non-essential (analytics purpose only), so
  // it is only minted once the visitor has opted in to the "Statistik"
  // category with a valid, current decision (versioned `gastro_cookie_consent`
  // with `statistics: true`, see `@/lib/consent/cookie`; written client-side by
  // `CookieConsentBanner`) -- never set unconditionally/before consent.
  const statisticsConsent = hasStatisticsConsent(request.cookies.get(CONSENT_COOKIE_NAME)?.value);
  const menuRouteMatch = PUBLIC_MENU_ROUTE_PATTERN.exec(request.nextUrl.pathname);
  if (menuRouteMatch) {
    const tenantSlug = menuRouteMatch[1]!;
    const cookieName = menuViewCookieName(tenantSlug);
    if (statisticsConsent) {
      if (!request.cookies.get(cookieName)) {
        const token = createOpaqueToken();
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax" as const,
          path: "/",
          maxAge: MENU_VIEW_COOKIE_MAX_AGE_SECONDS,
        };
        // Set on `request` (so this same request's Server Component can read
        // it via `cookies()` -- Server Components see the incoming request's
        // cookies, not the outgoing response's) *before* the response is
        // rebuilt from the updated request; `rebuildResponse` preserves any
        // Set-Cookie headers the Supabase refresh already applied.
        rebuildResponse(() => request.cookies.set(cookieName, token));
        response.cookies.set(cookieName, token, cookieOptions);
      }
    }
  }

  if (!statisticsConsent) {
    // Ticket #146 Opus repair-cycle finding + #162: without a valid statistics
    // opt-in (never decided, declined, withdrawn, legacy/expired decision) any
    // existing menu_view cookie is cleared on EVERY route, so withdrawing
    // consent from e.g. the cart page also removes it (the cookie is httpOnly
    // and can only be deleted server-side).
    for (const existing of request.cookies.getAll()) {
      if (!existing.name.startsWith(MENU_VIEW_COOKIE_PREFIX)) {
        continue;
      }
      rebuildResponse(() => request.cookies.delete(existing.name));
      response.cookies.delete(existing.name);
    }
  }

  return response;
}

export const config = {
  // Skips static assets/files, `/media` (dish photos), `/api/webhooks` and
  // `/landing` entirely: none of them read a session or the consent cookies.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|media(?:/|$)|api/webhooks(?:/|$)|landing(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|pdf)$).*)",
  ],
};

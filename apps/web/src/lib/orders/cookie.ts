import { cookies } from "next/headers";

const ORDER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 3; // 3 days

/**
 * One order-access cookie per tenant slug, mirroring
 * `apps/web/src/lib/cart/cookie.ts`'s per-tenant-slug namespacing rationale.
 * Stores only the raw guest order-access token (ticket #21) -- ticket #22's
 * status page reads this cookie to resolve the guest's most recent order
 * without requiring a URL-embedded token. The slug is only used to namespace
 * the *cookie name*; tenant_id is always re-resolved server-side from the
 * route slug, never trusted from this cookie.
 */
function orderCookieName(tenantSlug: string): string {
  const safeSlug = tenantSlug.replace(/[^a-z0-9-]/g, "");
  return `gastro_order_${safeSlug}`;
}

/** Reads the raw order-access token for this tenant slug from the request's cookies, if any. */
export async function readOrderAccessToken(tenantSlug: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(orderCookieName(tenantSlug))?.value ?? null;
}

/**
 * Writes the order-access token cookie after a successful checkout. Only
 * callable from a Server Action/Route Handler (Next.js forbids writing
 * cookies during a Server Component render) -- httpOnly, so the token is
 * never readable/tamperable from browser JS.
 */
export async function writeOrderAccessTokenCookie(tenantSlug: string, token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(orderCookieName(tenantSlug), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORDER_COOKIE_MAX_AGE_SECONDS,
  });
}

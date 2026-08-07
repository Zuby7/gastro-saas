import { cookies } from "next/headers";

const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

/**
 * One cart cookie per tenant slug -- this app serves every tenant's public
 * menu from the same origin (`/r/[slug]`), so a single shared cookie would
 * let a customer who browses two restaurants in the same browser session
 * mix up carts. The slug is only used to namespace the *cookie name*; it is
 * never trusted as a tenant id (tenant_id is always re-resolved server-side
 * from the slug via `resolveTenantIdBySlug`, see `service.ts`).
 */
function cartCookieName(tenantSlug: string): string {
  const safeSlug = tenantSlug.replace(/[^a-z0-9-]/g, "");
  return `gastro_cart_${safeSlug}`;
}

/** Reads the raw cart token for this tenant slug from the request's cookies, if any. */
export async function readCartToken(tenantSlug: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(cartCookieName(tenantSlug))?.value ?? null;
}

/**
 * Writes the cart token cookie. Only callable from a Server Action/Route
 * Handler (Next.js forbids writing cookies during a Server Component
 * render) -- httpOnly, so the token is never readable/tamperable from
 * browser JS, per CLAUDE.md's "no secrets in the browser" rule (a cart
 * token is not a secret in the credential sense, but the same storage
 * discipline avoids client-side tampering/theft via XSS).
 */
export async function writeCartTokenCookie(tenantSlug: string, token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(cartCookieName(tenantSlug), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}

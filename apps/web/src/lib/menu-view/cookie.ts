import { cookies } from "next/headers";

/**
 * One menu-view session cookie per tenant slug -- same rationale as
 * `apps/web/src/lib/cart/cookie.ts`'s per-tenant cart cookie: a single shared
 * cookie would let a visitor browsing two restaurants' menus in the same
 * browser session share one "session" between them, which would break the
 * per-tenant dedup this ticket requires and let one tenant's view count leak
 * information about another's. The slug only namespaces the *cookie name*;
 * tenant_id is always re-resolved server-side from the slug, never trusted
 * from this cookie's name or value.
 */
function menuViewCookieName(tenantSlug: string): string {
  const safeSlug = tenantSlug.replace(/[^a-z0-9-]/g, "");
  return `gastro_view_${safeSlug}`;
}

/** Reads the raw menu-view session token for this tenant slug, if any. */
export async function readMenuViewToken(tenantSlug: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(menuViewCookieName(tenantSlug))?.value ?? null;
}

export { menuViewCookieName };

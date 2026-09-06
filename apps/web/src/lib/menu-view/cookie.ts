import { cookies } from "next/headers";
import { menuViewCookieName } from "./cookie-name";

// One menu-view session cookie per tenant slug -- same rationale as
// `apps/web/src/lib/cart/cookie.ts`'s per-tenant cart cookie: a single shared
// cookie would let a visitor browsing two restaurants' menus in the same
// browser session share one "session" between them, which would break the
// per-tenant dedup this ticket requires and let one tenant's view count leak
// information about another's. The slug only namespaces the *cookie name*;
// tenant_id is always re-resolved server-side from the slug, never trusted
// from this cookie's name or value. Name derivation itself lives in
// `./cookie-name` (shared with `apps/web/src/middleware.ts`).

/** Reads the raw menu-view session token for this tenant slug, if any. */
export async function readMenuViewToken(tenantSlug: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(menuViewCookieName(tenantSlug))?.value ?? null;
}

export { menuViewCookieName };

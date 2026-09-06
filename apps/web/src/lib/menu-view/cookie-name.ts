/**
 * Shared tenant-slug sanitizer for the menu-view cookie name (ticket #67).
 *
 * Deliberately has no `next/headers` (or any other Next.js runtime) import
 * so it can be used from both a Server Component context
 * (`apps/web/src/lib/menu-view/cookie.ts`, which reads the cookie) and edge
 * middleware (`apps/web/src/middleware.ts`, which mints it) -- previously
 * each duplicated this exact regex independently, which risked the two
 * copies drifting apart and causing distinct slugs to collide on the same
 * cookie name (Opus finding, PR #129).
 */
export function menuViewCookieName(tenantSlug: string): string {
  const safeSlug = tenantSlug.replace(/[^a-z0-9-]/g, "");
  return `gastro_view_${safeSlug}`;
}

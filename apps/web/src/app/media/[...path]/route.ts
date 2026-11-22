import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Proxies reads of the private `dish-media` Storage bucket (see
 * `supabase/migrations/20260802090000_menu_admin_ui_support.sql`) for the
 * public menu (`apps/web/src/app/r/[slug]/dish-card.tsx` requests
 * `/media/<storage_path>`). The bucket is deliberately private (RLS-gated
 * to authenticated tenant members only, `dish_media_select_member`), but
 * dish photos must still be visible to anonymous guests browsing the
 * public menu -- so this route uses the service-role admin client
 * (bypasses Storage RLS, exactly like the other guest-facing read paths in
 * this codebase, e.g. `get_public_menu()`) and streams the bytes itself,
 * rather than making the bucket public. (It used to 307 to a fresh 60 s
 * signed URL per request, which made every image uncacheable; now the
 * response carries a day-long public cache lifetime plus an ETag.)
 *
 * Because the service-role client bypasses Storage RLS, this route must
 * enforce the equivalent authorization itself *before* reading any bytes
 * (docs/security/tenant-isolation.md, "Known risk areas" -- storage
 * objects). The requested path only ever gets served if it resolves to a
 * `media_assets` row (schema: `supabase/migrations/20260801110000_*.sql`)
 * that is referenced by a non-archived `dishes` row (`archived_at is
 * null`) belonging to that tenant's currently PUBLISHED `menu_versions`
 * row (`status = 'published'`). Any other path -- another tenant's asset,
 * a draft-only or archived dish's photo, or a path that doesn't
 * correspond to any known media asset at all -- gets the identical 404.
 * `path` itself is still never trusted as tenant scoping -- it's an
 * opaque path segment forwarded as-is from `get_public_menu()`'s
 * `image.path`, and the DB lookup below is what actually authorizes it.
 *
 * Caching: uploaded objects are immutable (`<tenant>/<uuid>.jpg`, written
 * with `upsert: false`), so the ETag is derived from the storage path and a
 * matching `If-None-Match` is answered with 304 after authorization but
 * without touching Storage. If a dish is later unpublished/archived, already
 * cached copies expire within the one-day `max-age`; that is the accepted
 * trade-off for these public menu photos.
 */

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=86400";
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function notFound() {
  return new NextResponse(null, { status: 404 });
}

function etagFor(storagePath: string): string {
  return `"${createHash("sha256").update(storagePath, "utf8").digest("hex").slice(0, 32)}"`;
}

function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) {
    return false;
  }
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === etag);
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  // Path-traversal guard: reject any "." or ".." segment before touching
  // the database or Storage at all.
  if (path.length === 0 || path.some((segment) => segment === "." || segment === "..")) {
    return notFound();
  }

  const storagePath = path.join("/");

  const admin = createSupabaseAdminClient();

  const { data: mediaAsset, error: mediaAssetError } = await admin
    .from("media_assets")
    .select("id, dishes!inner(id, archived_at, menu_versions!inner(status))")
    .eq("storage_path", storagePath)
    .is("dishes.archived_at", null)
    .eq("dishes.menu_versions.status", "published")
    .maybeSingle();

  if (mediaAssetError || !mediaAsset) {
    return notFound();
  }

  const etag = etagFor(storagePath);

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": CACHE_CONTROL },
    });
  }

  const { data: blob, error } = await admin.storage.from("dish-media").download(storagePath);

  if (error || !blob) {
    console.error("[media] storage download failed", error?.message ?? "no data");
    return notFound();
  }

  const contentType = ALLOWED_CONTENT_TYPES.has(blob.type) ? blob.type : "application/octet-stream";

  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
    },
  });
}

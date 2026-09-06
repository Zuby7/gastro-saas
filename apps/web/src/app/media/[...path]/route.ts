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
 * this codebase, e.g. `get_public_menu()`) to create a short-lived signed
 * URL and redirects the browser to it, rather than making the bucket
 * public or streaming bytes through this server.
 *
 * Because the service-role client bypasses Storage RLS, this route must
 * enforce the equivalent authorization itself *before* minting a signed
 * URL (docs/security/tenant-isolation.md, "Known risk areas" -- storage
 * objects). The requested path only ever gets signed if it resolves to a
 * `media_assets` row (schema: `supabase/migrations/20260801110000_*.sql`)
 * that is referenced by a non-archived `dishes` row (`archived_at is
 * null`) belonging to that tenant's currently PUBLISHED `menu_versions`
 * row (`status = 'published'`). Any other path -- another tenant's asset,
 * a draft-only or archived dish's photo, or a path that doesn't
 * correspond to any known media asset at all -- 404s, matching what the
 * RLS-gated bucket would have returned to a non-member caller anyway.
 * `path` itself is still never trusted as tenant scoping -- it's an
 * opaque path segment forwarded as-is from `get_public_menu()`'s
 * `image.path`, and the DB lookup below is what actually authorizes it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  // Path-traversal guard: reject any "." or ".." segment before touching
  // the database or Storage at all.
  if (path.length === 0 || path.some((segment) => segment === "." || segment === "..")) {
    return new NextResponse(null, { status: 404 });
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
    return new NextResponse(null, { status: 404 });
  }

  const { data, error } = await admin.storage.from("dish-media").createSignedUrl(storagePath, 60);

  if (error || !data?.signedUrl) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}

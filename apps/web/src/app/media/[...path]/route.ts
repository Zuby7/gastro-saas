import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Proxies reads of the private `dish-media` Storage bucket (see
 * `supabase/migrations/20260802090000_menu_admin_ui_support.sql`) for the
 * public menu (`apps/web/src/app/r/[slug]/dish-card.tsx` requests
 * `/media/<storage_path>`). The bucket is deliberately private (RLS-gated
 * to authenticated tenant members only), but dish photos must still be
 * visible to anonymous guests browsing the public menu -- so this route
 * uses the service-role admin client (bypasses RLS, exactly like the other
 * guest-facing read paths in this codebase, e.g. `get_public_menu()`) to
 * create a short-lived signed URL and redirects the browser to it, rather
 * than making the bucket public or streaming bytes through this server.
 *
 * `path` is the full `<tenant_id>/...` storage path already returned by
 * `get_public_menu()` as `image.path` -- never client-supplied tenant
 * scoping, just an opaque path segment forwarded as-is.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const storagePath = path.join("/");

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from("dish-media").createSignedUrl(storagePath, 60);

  if (error || !data?.signedUrl) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}

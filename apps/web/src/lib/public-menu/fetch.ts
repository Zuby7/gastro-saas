import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicLegalPage, PublicLegalPageKind, PublicMenu } from "./types";

/**
 * Wrapped in React `cache()` so the page, the layout/metadata and any other
 * Server Component in the same request share one `get_public_menu` RPC.
 */
export const getPublicMenu = cache(async (slug: string): Promise<PublicMenu | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_menu", { p_tenant_slug: slug });

  if (error || !data) {
    return null;
  }

  return data as PublicMenu;
});

/**
 * Narrow read of just the public tenant name, for pages (cart, checkout)
 * that only show it in the header and must not download the whole menu.
 * Reuses the existing narrow `get_public_legal_page` RPC (no migration);
 * returns `null` for an unknown slug so the page can 404.
 */
export const getPublicTenantName = cache(async (slug: string): Promise<string | null> => {
  const page = await getPublicLegalPage(slug, "imprint");
  return page?.tenantName ?? null;
});

/**
 * Ticket #41: dedicated narrow public read for the Impressum/Datenschutz
 * free text -- mirrors `getPublicMenu()`'s pattern, never a generic
 * `restaurant_profiles` select exposed to anon. Returns `null` if the tenant
 * slug doesn't exist so the page can 404.
 */
export async function getPublicLegalPage(
  slug: string,
  page: PublicLegalPageKind,
): Promise<PublicLegalPage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_legal_page", {
    p_tenant_slug: slug,
    p_page: page,
  });

  if (error || !data) {
    return null;
  }

  return data as PublicLegalPage;
}

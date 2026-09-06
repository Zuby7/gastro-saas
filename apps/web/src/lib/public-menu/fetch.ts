import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicLegalPage, PublicLegalPageKind, PublicMenu } from "./types";

export async function getPublicMenu(slug: string): Promise<PublicMenu | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_menu", { p_tenant_slug: slug });

  if (error || !data) {
    return null;
  }

  return data as PublicMenu;
}

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

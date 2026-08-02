import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicMenu } from "./types";

export async function getPublicMenu(slug: string): Promise<PublicMenu | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_menu", { p_tenant_slug: slug });

  if (error || !data) {
    return null;
  }

  return data as PublicMenu;
}

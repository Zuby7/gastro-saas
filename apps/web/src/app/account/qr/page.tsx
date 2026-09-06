import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface MembershipRow {
  tenant_id: string;
  tenants: { slug: string; name: string } | null;
}

export default async function QrGeneratorPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants ( slug, name )")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<MembershipRow>();

  if (!membership?.tenants) {
    redirect("/account");
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-md flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">QR-Code</h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
          <p className="text-sm text-foreground-secondary">{membership.tenants.name}</p>

          <form action="/api/qr" method="GET" className="flex flex-col gap-4">
            <input type="hidden" name="slug" value={membership.tenants.slug} />
            <div className="flex flex-col gap-1">
              <label htmlFor="table" className="text-sm font-medium text-foreground">
                Tisch oder Bereich
              </label>
              <input
                id="table"
                name="table"
                type="text"
                placeholder="12"
                className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="pickup"
                value="1"
                className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              />
              Abholung
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              QR-Code herunterladen
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

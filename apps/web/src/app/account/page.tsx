import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { roleLabel } from "@/lib/auth/role-labels";
import { logoutAction } from "./actions";
import { CreateTenantForm } from "./create-tenant-form";
import { InviteMemberForm } from "./invite-member-form";

interface TenantMembershipRow {
  tenant_id: string;
  role: string;
  tenants: { name: string; slug: string } | null;
}

interface RoleRow {
  id: string;
  key: string;
  name: string;
}

/**
 * Minimal protected route: server-side session validation via
 * `supabase.auth.getUser()` (validates against the Auth server, not just a
 * locally-decoded JWT) -- redirects to `/login` for anyone without a valid
 * session. Not gated on any particular role/permission (that's ticket #9's
 * scope); this page only proves the "protected route" pattern this ticket's
 * acceptance criteria call for.
 *
 * A session with zero tenant memberships (ticket #7 fix cycle 1, item 4/5:
 * an orphaned auth user from a failed create_tenant_with_owner() call at
 * registration, or a just-confirmed-email user whose tenant creation was
 * deferred to first login) renders the "create your restaurant" fallback
 * instead of the normal welcome content.
 */
export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants ( name, slug )")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<TenantMembershipRow>();

  const { data: roles } = membership
    ? await supabase
        .from("roles")
        .select("id, key, name")
        .eq("tenant_id", membership.tenant_id)
        .order("name")
        .returns<RoleRow[]>()
    : { data: [] as RoleRow[] };

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">Willkommen</h1>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              Abmelden
            </button>
          </form>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium text-foreground-secondary">Angemeldet als</dt>
            <dd className="text-foreground">{user.email}</dd>
            {membership?.tenants ? (
              <>
                <dt className="font-medium text-foreground-secondary">Restaurant</dt>
                <dd className="text-foreground">{membership.tenants.name}</dd>
                <dt className="font-medium text-foreground-secondary">Rolle</dt>
                <dd className="text-foreground">{roleLabel(membership.role)}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {!membership ? (
          <CreateTenantForm
            defaultTenantName={
              typeof user.user_metadata?.tenant_name === "string"
                ? user.user_metadata.tenant_name
                : undefined
            }
            defaultTenantSlug={
              typeof user.user_metadata?.tenant_slug === "string"
                ? user.user_metadata.tenant_slug
                : undefined
            }
          />
        ) : null}
        {membership ? <InviteMemberForm roles={roles ?? []} /> : null}

        {membership ? (
          <div className="flex flex-wrap gap-4">
            <Link
              href="/account/privacy"
              className="w-fit text-sm font-medium text-link-foreground underline hover:text-brand-700"
            >
              Datenschutz-Einstellungen (Export/Löschantrag)
            </Link>
            <Link
              href="/account/integrations"
              className="w-fit text-sm font-medium text-link-foreground underline hover:text-brand-700"
            >
              Integrationen (Mock-Anbindung)
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Willkommen</h1>

      <dl className="flex flex-col gap-2 text-sm text-foreground">
        <div>
          <dt className="font-medium">Angemeldet als</dt>
          <dd>{user.email}</dd>
        </div>
        {membership?.tenants ? (
          <>
            <div>
              <dt className="font-medium">Restaurant</dt>
              <dd>{membership.tenants.name}</dd>
            </div>
            <div>
              <dt className="font-medium">Rolle</dt>
              <dd>{roleLabel(membership.role)}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {!membership ? <CreateTenantForm /> : null}
      {membership ? <InviteMemberForm roles={roles ?? []} /> : null}

      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-foreground"
        >
          Abmelden
        </button>
      </form>
    </main>
  );
}

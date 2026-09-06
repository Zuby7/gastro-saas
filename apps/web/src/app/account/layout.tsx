import { AccountNav } from "./account-nav";

/**
 * Shared chrome for every `/account/**` page (visual-polish pass -- purely
 * additive presentation, no auth/data-fetching change): adds a persistent
 * top nav so the dashboard reads as one connected app instead of a stack of
 * disconnected pages each with its own "Zurück" link. Deliberately does not
 * duplicate any session/permission check here -- every page under this
 * layout already performs its own `supabase.auth.getUser()` +
 * `requireTenantPermission` gate and redirects/renders its own
 * access-denied state, so this layout never needs to (and must not)
 * short-circuit rendering itself.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AccountNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}

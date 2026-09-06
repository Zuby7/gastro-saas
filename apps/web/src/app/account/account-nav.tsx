"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AccountNavLink {
  href: string;
  label: string;
}

/**
 * Persistent chrome shared by every `/account/**` page (visual-polish pass,
 * no acceptance-criteria/behavior change): before this, each page was an
 * island with its own ad-hoc "Zurück" link back to `/account` and no way to
 * jump directly between sections. This is presentation only -- every linked
 * page independently re-checks its own permission gate server-side (see
 * e.g. `./integrations/page.tsx`), so a link rendering here for a member
 * without that permission just leads to that page's own access-denied
 * message, never a bypass.
 */
const NAV_LINKS: AccountNavLink[] = [
  { href: "/account", label: "Übersicht" },
  { href: "/account/menu", label: "Speisekarte" },
  { href: "/account/orders", label: "Bestellungen" },
  { href: "/account/payments", label: "Zahlungen" },
  { href: "/account/analytics", label: "Analytics" },
  { href: "/account/reviews", label: "Bewertungen" },
  { href: "/account/integrations", label: "Integrationen" },
  { href: "/account/privacy", label: "Datenschutz" },
  { href: "/account/profile", label: "Profil" },
  { href: "/account/qr", label: "QR-Code" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/account") {
    return pathname === "/account";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AccountNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto px-5 py-3 sm:px-8">
        <span className="shrink-0 font-display text-sm font-semibold tracking-wide text-foreground">
          gastro-saas
        </span>
        <nav aria-label="Konto-Navigation" className="flex shrink-0 items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
                  active
                    ? "bg-surface-muted text-foreground"
                    : "text-foreground-secondary hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

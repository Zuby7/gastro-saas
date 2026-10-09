import type { ReactNode } from "react";
import { CookieConsentBanner } from "./cookie-consent-banner";

interface PublicRestaurantLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Ticket #162: every public restaurant page (menu, cart, checkout, order
 * status, receipt, AGB/Datenschutz/Impressum) gets the consent banner and the
 * persistent "Cookie-Einstellungen" link from this one layout, so withdrawal
 * is always as easy as giving consent (Art. 7 Abs. 3 DSGVO) and no page can
 * forget it.
 */
export default async function PublicRestaurantLayout({
  children,
  params,
}: PublicRestaurantLayoutProps) {
  const { slug } = await params;

  return (
    <>
      {children}
      <CookieConsentBanner tenantSlug={slug} />
    </>
  );
}

import Link from "next/link";

/**
 * Ticket #163: persistent "Cookie-Hinweise" link for the platform pages
 * outside `/r/[slug]`. These pages only ever set strictly necessary cookies
 * (no consent category to toggle), so the link leads to the cookie section of
 * the platform Datenschutzerklaerung, which lists them and says so.
 */
export function PlatformCookieLink({ className }: { className?: string }) {
  return (
    <Link
      href="/datenschutz#cookies"
      className={className ?? "font-medium text-link-foreground underline hover:text-foreground"}
    >
      Cookie-Hinweise
    </Link>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLegalPage } from "@/lib/public-menu/fetch";

interface AgbPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Ticket #146: public AGB page (terms & conditions, including the tenant's
 * own Widerrufsrecht/Rückerstattungsrichtlinie text), extending ticket #41's
 * Impressum/Datenschutz pattern with a third tenant-editable free-text page.
 * Rendered as plain text only (no `dangerouslySetInnerHTML`) -- see
 * `../impressum/page.tsx`'s comment for the same XSS-safety rationale.
 *
 * This text is entirely tenant-authored -- neither this page nor the
 * `restaurant_profiles.legal_terms_text` field it renders constitutes
 * legally-binding AGB/Widerrufsrecht text written by this codebase; see
 * `docs/legal/rechtsgrundlagen-uebersicht.md`.
 */
export default async function AgbPage({ params }: AgbPageProps) {
  const { slug } = await params;
  const legalPage = await getPublicLegalPage(slug, "terms");

  if (!legalPage) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            AGB &amp; Widerrufsrecht: {legalPage.tenantName}
          </h1>
          <Link
            href={`/r/${slug}`}
            className="shrink-0 text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Speisekarte
          </Link>
        </div>

        {legalPage.text ? (
          <p className="whitespace-pre-wrap leading-relaxed text-foreground">{legalPage.text}</p>
        ) : (
          <p className="text-foreground-secondary">
            Für dieses Restaurant wurden noch keine AGB hinterlegt.
          </p>
        )}
      </div>
    </main>
  );
}

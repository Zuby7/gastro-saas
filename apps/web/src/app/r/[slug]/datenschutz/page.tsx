import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLegalPage } from "@/lib/public-menu/fetch";

interface DatenschutzPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Ticket #41: public Datenschutzerklärung page, linked from the checkout
 * privacy notice. Rendered as plain text only (no
 * `dangerouslySetInnerHTML`) -- see `../impressum/page.tsx`'s comment for
 * the same rationale.
 */
export default async function DatenschutzPage({ params }: DatenschutzPageProps) {
  const { slug } = await params;
  const legalPage = await getPublicLegalPage(slug, "privacy");

  if (!legalPage) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Datenschutzerklärung &ndash; {legalPage.tenantName}
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
            Für dieses Restaurant wurde noch keine Datenschutzerklärung hinterlegt.
          </p>
        )}
      </div>
    </main>
  );
}

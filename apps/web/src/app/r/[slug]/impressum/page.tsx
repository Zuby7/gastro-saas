import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLegalPage } from "@/lib/public-menu/fetch";

interface ImpressumPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Ticket #41: public Impressum page. Rendered as plain text only (no
 * `dangerouslySetInnerHTML`) -- React escapes all text-node content, which
 * is the sanitization guarantee against XSS via the tenant-authored free
 * text (see the migration's header comment for the reasoning).
 */
export default async function ImpressumPage({ params }: ImpressumPageProps) {
  const { slug } = await params;
  const legalPage = await getPublicLegalPage(slug, "imprint");

  if (!legalPage) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Impressum &ndash; {legalPage.tenantName}
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
            Für dieses Restaurant wurde noch kein Impressum hinterlegt.
          </p>
        )}
      </div>
    </main>
  );
}

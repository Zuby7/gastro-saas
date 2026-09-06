import Link from "next/link";

/**
 * Ticket #146: static, platform-level AGB page for gastro-saas itself (the
 * contract between the platform operator and a restaurant owner signing
 * up), distinct from the per-tenant AGB page at `/r/[slug]/agb` (ticket
 * #146's tenant-editable order terms, shown to diners at checkout).
 *
 * This is a hard-coded placeholder, not Claude-authored legally-binding
 * terms -- see `docs/legal/rechtsgrundlagen-uebersicht.md`'s explicit
 * disclaimer. It exists so the registration form's required consent
 * checkbox has something concrete to link to.
 */
export default function PlatformAgbPage() {
  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Allgemeine Geschäftsbedingungen
          </h1>
          <Link
            href="/"
            className="shrink-0 text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Startseite
          </Link>
        </div>

        <p className="rounded-md border border-neutral-300 bg-surface-muted p-3 text-sm text-foreground-secondary">
          Platzhaltertext. Die verbindlichen Allgemeinen Geschäftsbedingungen für die Nutzung von
          gastro-saas werden vor dem Produktivbetrieb von einer Rechtsanwältin/einem Rechtsanwalt
          geprüft und hier eingetragen. Dieser Text ist keine Rechtsberatung und begründet keine
          rechtliche Verbindlichkeit.
        </p>
      </div>
    </main>
  );
}

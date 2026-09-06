import Link from "next/link";

/**
 * Ticket #146: static, platform-level Datenschutzerklärung for gastro-saas
 * itself (data processed about restaurant owners/staff using the platform),
 * distinct from the per-tenant Datenschutz page at `/r/[slug]/datenschutz`
 * (ticket #41's tenant-editable privacy notice, shown to diners).
 *
 * This is a hard-coded placeholder, not Claude-authored legally-binding
 * text -- see `docs/legal/rechtsgrundlagen-uebersicht.md`'s explicit
 * disclaimer. It exists so the registration form's required consent
 * checkbox has something concrete to link to.
 */
export default function PlatformDatenschutzPage() {
  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Datenschutzerklärung
          </h1>
          <Link
            href="/"
            className="shrink-0 text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Startseite
          </Link>
        </div>

        <p className="rounded-md border border-neutral-300 bg-surface-muted p-3 text-sm text-foreground-secondary">
          Platzhaltertext. Die verbindliche Datenschutzerklärung für die Nutzung von gastro-saas
          durch Restaurant-Betreiber:innen wird vor dem Produktivbetrieb von einer
          Rechtsanwältin/einem Rechtsanwalt geprüft und hier eingetragen. Dieser Text ist keine
          Rechtsberatung.
        </p>
      </div>
    </main>
  );
}

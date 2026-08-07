export default function PublicMenuNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-neutral-50 p-8">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        Speisekarte nicht verfügbar
      </h1>
      <p className="text-foreground-secondary">
        Diese Speisekarte ist aktuell nicht veröffentlicht oder der Link ist ungültig.
      </p>
    </main>
  );
}

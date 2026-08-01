export default function PublicMenuNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Speisekarte nicht verfÃ¼gbar</h1>
      <p className="text-foreground-secondary">
        Diese Speisekarte ist aktuell nicht verÃ¶ffentlicht oder der Link ist ungÃ¼ltig.
      </p>
    </main>
  );
}

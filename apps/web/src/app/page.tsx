import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-16">
      <h1 className="font-display text-3xl font-semibold text-foreground">gastro-saas</h1>
      <p className="text-base text-foreground-secondary">
        Foundation placeholder — no features yet.
      </p>
      <nav className="flex gap-4 text-sm">
        <Link href="/register" className="font-medium text-link-foreground underline">
          Restaurant registrieren
        </Link>
        <Link href="/login" className="font-medium text-link-foreground underline">
          Anmelden
        </Link>
      </nav>
    </main>
  );
}

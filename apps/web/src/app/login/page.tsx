"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {};

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-secondary p-8">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-neutral-200 bg-surface p-8 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Anmelden</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            Melden Sie sich bei Ihrem Konto an.
          </p>
        </div>

        {state.error ? (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-foreground"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {isPending ? "Anmeldung läuft…" : "Anmelden"}
          </button>
        </form>

        <p className="text-sm text-foreground-secondary">
          Noch kein Konto?{" "}
          <Link href="/register" className="font-medium text-link-foreground underline">
            Restaurant registrieren
          </Link>
        </p>
      </div>
    </main>
  );
}

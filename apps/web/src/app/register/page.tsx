"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type RegisterFormState } from "./actions";

const initialState: RegisterFormState = {};

export default function RegisterPage() {
  const [state, formAction, isPending] = useActionState(registerAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Restaurant registrieren</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Erstellen Sie Ihr Konto — Sie werden automatisch Inhaber Ihres neuen Restaurants.
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

      {state.info ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-neutral-300 bg-surface-muted p-3 text-sm text-foreground"
        >
          {state.info}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="tenantName" className="text-sm font-medium text-foreground">
            Restaurantname
          </label>
          <input
            id="tenantName"
            name="tenantName"
            type="text"
            autoComplete="organization"
            required
            aria-invalid={state.fieldErrors?.tenantName ? true : undefined}
            aria-describedby={state.fieldErrors?.tenantName ? "tenantName-error" : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.tenantName ? (
            <span id="tenantName-error" className="text-sm text-danger-foreground">
              {state.fieldErrors.tenantName}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tenantSlug" className="text-sm font-medium text-foreground">
            Web-Adresse Ihres Restaurants (Teil des Links zu Ihrer Speisekarte)
          </label>
          <input
            id="tenantSlug"
            name="tenantSlug"
            type="text"
            placeholder="mein-restaurant"
            required
            aria-invalid={state.fieldErrors?.tenantSlug ? true : undefined}
            aria-describedby={state.fieldErrors?.tenantSlug ? "tenantSlug-error" : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.tenantSlug ? (
            <span id="tenantSlug-error" className="text-sm text-danger-foreground">
              {state.fieldErrors.tenantSlug}
            </span>
          ) : null}
        </div>

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
            aria-invalid={state.fieldErrors?.email ? true : undefined}
            aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.email ? (
            <span id="email-error" className="text-sm text-danger-foreground">
              {state.fieldErrors.email}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            aria-invalid={state.fieldErrors?.password ? true : undefined}
            aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.password ? (
            <span id="password-error" className="text-sm text-danger-foreground">
              {state.fieldErrors.password}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              id="acceptTerms"
              name="acceptTerms"
              type="checkbox"
              required
              aria-invalid={state.fieldErrors?.acceptTerms ? true : undefined}
              aria-describedby={state.fieldErrors?.acceptTerms ? "acceptTerms-error" : undefined}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            <span>
              Ich akzeptiere die{" "}
              <Link
                href="/agb"
                target="_blank"
                className="font-medium text-link-foreground underline"
              >
                AGB
              </Link>{" "}
              und die{" "}
              <Link
                href="/datenschutz"
                target="_blank"
                className="font-medium text-link-foreground underline"
              >
                Datenschutzerklärung
              </Link>
              .
            </span>
          </label>
          {state.fieldErrors?.acceptTerms ? (
            <span id="acceptTerms-error" className="text-sm text-danger-foreground">
              {state.fieldErrors.acceptTerms}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Registrierung läuft…" : "Registrieren"}
        </button>
      </form>

      <p className="text-sm text-foreground-secondary">
        Bereits registriert?{" "}
        <Link href="/login" className="font-medium text-link-foreground underline">
          Anmelden
        </Link>
      </p>
    </main>
  );
}

"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileFormState } from "./actions";

export interface ProfileFormInitialValues {
  displayName: string;
  description: string;
  contactEmail: string;
  phone: string;
  timezone: string;
  brandColor: string;
  legalImprintText: string;
  legalPrivacyText: string;
}

const initialState: ProfileFormState = {};

export function ProfileForm({ initial }: { initial: ProfileFormInitialValues }) {
  const [state, formAction, isPending] = useActionState(saveProfileAction, initialState);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Restaurant-Profil</h2>

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-600"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-neutral-300 bg-neutral-100 p-3 text-sm text-foreground"
        >
          {state.success}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName" className="text-sm font-medium text-foreground">
            Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            defaultValue={initial.displayName}
            aria-invalid={state.fieldErrors?.displayName ? true : undefined}
            aria-describedby={state.fieldErrors?.displayName ? "displayName-error" : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.displayName ? (
            <span id="displayName-error" className="text-sm text-danger-600">
              {state.fieldErrors.displayName}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-foreground">
            Beschreibung
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={initial.description}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="contactEmail" className="text-sm font-medium text-foreground">
            Kontakt-E-Mail
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={initial.contactEmail}
            aria-invalid={state.fieldErrors?.contactEmail ? true : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.contactEmail ? (
            <span className="text-sm text-danger-600">{state.fieldErrors.contactEmail}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium text-foreground">
            Telefon
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial.phone}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="timezone" className="text-sm font-medium text-foreground">
            Zeitzone
          </label>
          <input
            id="timezone"
            name="timezone"
            type="text"
            required
            defaultValue={initial.timezone}
            placeholder="Europe/Berlin"
            aria-invalid={state.fieldErrors?.timezone ? true : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.timezone ? (
            <span className="text-sm text-danger-600">{state.fieldErrors.timezone}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="brandColor" className="text-sm font-medium text-foreground">
            Markenfarbe
          </label>
          <input
            id="brandColor"
            name="brandColor"
            type="text"
            required
            defaultValue={initial.brandColor}
            placeholder="#166534"
            aria-invalid={state.fieldErrors?.brandColor ? true : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.brandColor ? (
            <span className="text-sm text-danger-600">{state.fieldErrors.brandColor}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="legalImprintText" className="text-sm font-medium text-foreground">
            Impressum
          </label>
          <p className="text-sm text-neutral-500">
            Freitext, wird 1:1 (ohne HTML-Formatierung) auf der öffentlichen Impressum-Seite
            angezeigt.
          </p>
          <textarea
            id="legalImprintText"
            name="legalImprintText"
            rows={8}
            defaultValue={initial.legalImprintText}
            aria-invalid={state.fieldErrors?.legalImprintText ? true : undefined}
            aria-describedby={
              state.fieldErrors?.legalImprintText ? "legalImprintText-error" : undefined
            }
            className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm text-foreground"
          />
          {state.fieldErrors?.legalImprintText ? (
            <span id="legalImprintText-error" className="text-sm text-danger-600">
              {state.fieldErrors.legalImprintText}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="legalPrivacyText" className="text-sm font-medium text-foreground">
            Datenschutzerklärung
          </label>
          <p className="text-sm text-neutral-500">
            Freitext, wird 1:1 (ohne HTML-Formatierung) auf der öffentlichen
            Datenschutz-Seite und im Checkout-Hinweis verlinkt angezeigt.
          </p>
          <textarea
            id="legalPrivacyText"
            name="legalPrivacyText"
            rows={8}
            defaultValue={initial.legalPrivacyText}
            aria-invalid={state.fieldErrors?.legalPrivacyText ? true : undefined}
            aria-describedby={
              state.fieldErrors?.legalPrivacyText ? "legalPrivacyText-error" : undefined
            }
            className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm text-foreground"
          />
          {state.fieldErrors?.legalPrivacyText ? (
            <span id="legalPrivacyText-error" className="text-sm text-danger-600">
              {state.fieldErrors.legalPrivacyText}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
        >
          {isPending ? "Wird gespeichert…" : "Profil speichern"}
        </button>
      </form>
    </section>
  );
}

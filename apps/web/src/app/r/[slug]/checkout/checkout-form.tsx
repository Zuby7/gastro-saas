"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutFormState } from "./actions";

interface CheckoutFormProps {
  tenantSlug: string;
  checkoutReady: boolean;
}

const initialState: CheckoutFormState = {};

export function CheckoutForm({ tenantSlug, checkoutReady }: CheckoutFormProps) {
  // `tenantSlug` is bound server-side, not read from a client-editable form
  // field -- see the doc comment on `checkoutAction` in `./actions.ts`.
  const [state, formAction, isPending] = useActionState(
    checkoutAction.bind(null, tenantSlug),
    initialState,
  );
  const [fulfillmentType, setFulfillmentType] = useState<"pickup" | "table">("pickup");

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-foreground">
          Wie möchten Sie bestellen?
        </legend>
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="radio"
            name="fulfillmentType"
            value="pickup"
            checked={fulfillmentType === "pickup"}
            onChange={() => setFulfillmentType("pickup")}
            className="h-4 w-4 accent-brand-600"
          />
          Abholung
        </label>
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="radio"
            name="fulfillmentType"
            value="table"
            checked={fulfillmentType === "table"}
            onChange={() => setFulfillmentType("table")}
            className="h-4 w-4 accent-brand-600"
          />
          Tischbestellung
        </label>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="customerName" className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id="customerName"
          name="customerName"
          type="text"
          required
          maxLength={200}
          autoComplete="name"
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
        />
      </div>

      {fulfillmentType === "pickup" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="customerPhone" className="text-sm font-medium text-foreground">
            Telefonnummer (optional, für Rückfragen zur Abholung)
          </label>
          <input
            id="customerPhone"
            name="customerPhone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="tableIdentifier" className="text-sm font-medium text-foreground">
            Tischnummer
          </label>
          <input
            id="tableIdentifier"
            name="tableIdentifier"
            type="text"
            required
            maxLength={40}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="customerNote" className="text-sm font-medium text-foreground">
          Hinweis (optional)
        </label>
        <textarea
          id="customerNote"
          name="customerNote"
          maxLength={500}
          rows={3}
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm font-medium text-danger-foreground"
        >
          {state.error}
        </p>
      ) : null}

      {!checkoutReady ? (
        <p
          role="alert"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm font-medium text-danger-foreground"
        >
          Ihr Warenkorb enthält nicht mehr verfügbare Artikel oder ist leer. Bitte prüfen Sie Ihren
          Warenkorb, bevor Sie fortfahren.
        </p>
      ) : null}

      {/*
        Ticket #41: privacy notice shown before order submission, with a
        link to the full Datenschutzerklärung. Required by the acceptance
        criteria -- not gated behind a checkbox (the ticket's non-goal
        explicitly rules out building a general cookie-consent-banner
        toolkit beyond what Turnstile/PostHog need).
      */}
      <p className="text-sm text-foreground-secondary">
        Mit dem Absenden der Bestellung werden Ihre Angaben (Name, Kontaktdaten, Bestellinhalt) zur
        Abwicklung Ihrer Bestellung verarbeitet. Details finden Sie in unserer{" "}
        <Link
          href={`/r/${tenantSlug}/datenschutz`}
          className="font-medium text-link-foreground underline hover:text-brand-700"
        >
          Datenschutzerklärung
        </Link>
        .
      </p>

      <button
        type="submit"
        disabled={isPending || !checkoutReady}
        className="rounded-md bg-brand-600 px-4 py-3 font-medium text-neutral-0 transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Bestellung wird aufgegeben…" : "Bestellung abschicken"}
      </button>
    </form>
  );
}

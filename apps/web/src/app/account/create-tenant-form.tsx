"use client";

import { useActionState } from "react";
import { createTenantAction, type CreateTenantFormState } from "./actions";

const initialState: CreateTenantFormState = {};

/**
 * Onboarding-completion fallback form (ticket #7 fix cycle 1, item 4/5) --
 * see `actions.ts`'s `createTenantAction` for the cases this covers.
 */
export function CreateTenantForm() {
  const [state, formAction, isPending] = useActionState(createTenantAction, initialState);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-neutral-300 p-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Restaurant anlegen</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          Sie sind angemeldet, aber noch keinem Restaurant zugeordnet. Legen Sie jetzt Ihr
          Restaurant an, um fortzufahren.
        </p>
      </div>

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-600"
        >
          {state.error}
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
            <span id="tenantName-error" className="text-sm text-danger-600">
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
            <span id="tenantSlug-error" className="text-sm text-danger-600">
              {state.fieldErrors.tenantSlug}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Restaurant wird angelegt…" : "Restaurant anlegen"}
        </button>
      </form>
    </div>
  );
}

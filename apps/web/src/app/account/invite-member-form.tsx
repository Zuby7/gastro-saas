"use client";

import { useActionState } from "react";
import { inviteMemberAction, type InviteMemberFormState } from "./actions";

interface RoleOption {
  id: string;
  name: string;
}

interface InviteMemberFormProps {
  roles: RoleOption[];
}

const initialState: InviteMemberFormState = {};

export function InviteMemberForm({ roles }: InviteMemberFormProps) {
  const [state, formAction, isPending] = useActionState(inviteMemberAction, initialState);

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-300 p-4">
      <h2 className="text-lg font-semibold text-foreground">Mitarbeiter einladen</h2>

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
          <label htmlFor="invite-email" className="text-sm font-medium text-foreground">
            E-Mail-Adresse
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={state.fieldErrors?.email ? true : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.email ? (
            <span className="text-sm text-danger-600">{state.fieldErrors.email}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="invite-role" className="text-sm font-medium text-foreground">
            Rolle
          </label>
          <select
            id="invite-role"
            name="roleId"
            required
            aria-invalid={state.fieldErrors?.roleId ? true : undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          {state.fieldErrors?.roleId ? (
            <span className="text-sm text-danger-600">{state.fieldErrors.roleId}</span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending || roles.length === 0}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Einladung wird erstellt..." : "Einladung senden"}
        </button>
      </form>
    </section>
  );
}

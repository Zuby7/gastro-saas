"use client";

import { useActionState } from "react";
import { acceptInvitationAction, type AcceptInvitationFormState } from "./actions";

interface AcceptInvitationFormProps {
  token: string;
}

const initialState: AcceptInvitationFormState = {};

export function AcceptInvitationForm({ token }: AcceptInvitationFormProps) {
  const [state, formAction, isPending] = useActionState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-foreground"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
      >
        {isPending ? "Einladung wird angenommen..." : "Einladung annehmen"}
      </button>
    </form>
  );
}

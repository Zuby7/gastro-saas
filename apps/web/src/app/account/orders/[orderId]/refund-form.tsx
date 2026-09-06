"use client";

import { useActionState, useEffect, useState } from "react";
import { issueRefundAction, type RefundActionState } from "./actions";

const initialState: RefundActionState = {};

export function RefundForm({
  orderId,
  remainingRefundableCents,
}: {
  orderId: string;
  remainingRefundableCents: number;
}) {
  const [state, formAction, isPending] = useActionState(issueRefundAction, initialState);
  // Request idempotency token (issue #97, risk:payment): minted ONCE per form
  // instance, and only rotated after a *successful* submission -- never
  // inside `onSubmit`. Minting it inside `onSubmit` was the original bug: a
  // double-click before `isPending` flips true fired the action twice with
  // TWO DIFFERENT tokens, so the server-side unique index on `requestToken`
  // never caught the duplicate (see refund-service.ts's
  // DuplicateRefundRequestError) -- defeating the whole point of the ticket.
  //
  // The token is populated in a post-mount effect rather than a `useState`
  // initializer, because a lazy initializer still runs during SSR; calling
  // `crypto.randomUUID()` there would produce a different value on the
  // server-rendered HTML than on the client's first render, causing a
  // hydration mismatch. Starting from "" (identical on server and client)
  // and filling it in only after mount avoids that. This is a genuine
  // "synchronize with an external system" effect (the browser's crypto RNG
  // is only available/meaningful post-mount), so the one-time mint is
  // exempted from `react-hooks/set-state-in-effect` below.
  const [requestToken, setRequestToken] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: client-only RNG value, not derivable during render/SSR.
    setRequestToken(crypto.randomUUID());
  }, []);

  // Rotate the token after a successful submission -- derived directly during
  // render (React's documented "storing information from previous renders"
  // pattern), mirroring this codebase's existing convention of avoiding
  // effects for state that can be computed from the current render's props/
  // state (see `cart-line.tsx`). Calling `setState` conditionally here, while
  // rendering, triggers an immediate re-render before the browser paints --
  // it is not a `set-state-in-effect` violation since there is no effect.
  const [lastRotatedForSuccess, setLastRotatedForSuccess] = useState<string | undefined>(undefined);
  if (state.success && state.success !== lastRotatedForSuccess) {
    setLastRotatedForSuccess(state.success);
    setRequestToken(crypto.randomUUID());
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      noValidate
      aria-labelledby="refund-form-heading"
    >
      <h3 id="refund-form-heading" className="text-base font-medium text-foreground">
        Rückerstattung auslösen
      </h3>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="requestToken" value={requestToken} />

      <div className="flex flex-col gap-1">
        <label htmlFor="refund-amount" className="text-sm font-medium text-foreground">
          Betrag (in Cent, max. {remainingRefundableCents})
        </label>
        <input
          id="refund-amount"
          name="amountCents"
          type="text"
          inputMode="numeric"
          required
          defaultValue={remainingRefundableCents > 0 ? String(remainingRefundableCents) : undefined}
          aria-invalid={state.fieldErrors?.amountCents ? true : undefined}
          aria-describedby={state.fieldErrors?.amountCents ? "refund-amount-error" : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
        />
        {state.fieldErrors?.amountCents ? (
          <p id="refund-amount-error" role="alert" className="text-sm text-danger-foreground">
            {state.fieldErrors.amountCents}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="refund-reason" className="text-sm font-medium text-foreground">
          Grund (erforderlich)
        </label>
        <textarea
          id="refund-reason"
          name="reason"
          required
          rows={3}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={state.fieldErrors?.reason ? "refund-reason-error" : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
        />
        {state.fieldErrors?.reason ? (
          <p id="refund-reason-error" role="alert" className="text-sm text-danger-foreground">
            {state.fieldErrors.reason}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending || remainingRefundableCents <= 0 || !requestToken}
        className="w-fit rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird ausgelöst…" : "Rückerstattung auslösen"}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-success-600">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState, useRef } from "react";
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
  // Request idempotency token (issue #97, risk:payment): one crypto.randomUUID()
  // per submission attempt. A double-click before `isPending` flips true
  // submits this SAME value twice -- the server rejects the repeat
  // (see refund-service.ts's DuplicateRefundRequestError). The hidden input is
  // uncontrolled; we mutate its DOM value directly in the submit handler
  // (synchronously, before the native submission is captured) so every new
  // submission attempt gets a fresh token without a setState-in-effect
  // cascading-render pattern.
  const requestTokenRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      noValidate
      aria-labelledby="refund-form-heading"
      onSubmit={() => {
        if (requestTokenRef.current) {
          requestTokenRef.current.value = crypto.randomUUID();
        }
      }}
    >
      <h3 id="refund-form-heading" className="text-base font-medium text-foreground">
        Rückerstattung auslösen
      </h3>
      <input type="hidden" name="orderId" value={orderId} />
      <input
        ref={requestTokenRef}
        type="hidden"
        name="requestToken"
        defaultValue={crypto.randomUUID()}
      />

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
          <p id="refund-amount-error" role="alert" className="text-sm text-danger-600">
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
          <p id="refund-reason-error" role="alert" className="text-sm text-danger-600">
            {state.fieldErrors.reason}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending || remainingRefundableCents <= 0}
        className="w-fit rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird ausgelöst…" : "Rückerstattung auslösen"}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-danger-600">
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

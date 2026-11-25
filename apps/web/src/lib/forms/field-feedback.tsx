"use client";

import { useState } from "react";

interface FeedbackState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Hides a success message as soon as the user edits the form again. Every
 * action result is a new state object, so keying the dismissal by identity
 * keeps the next (possibly identical) success message visible.
 */
export function useDismissOnEdit(state: FeedbackState) {
  const [dismissedState, setDismissedState] = useState<FeedbackState | null>(null);
  return {
    dismissed: dismissedState === state,
    /** Attach to the `<form>` as `onInput` (in addition to the preserved-action props). */
    onEdit: () => setDismissedState(state),
  };
}

/** `aria-invalid` + `aria-describedby` props for an input with a field error. */
export function fieldErrorProps(state: FeedbackState, name: string, errorId: string) {
  const invalid = Boolean(state.fieldErrors?.[name]);
  return {
    "aria-invalid": invalid ? (true as const) : undefined,
    "aria-describedby": invalid ? errorId : undefined,
  };
}

/** Inline error text under a field; announced through the input's aria-describedby. */
export function FieldError({
  id,
  state,
  name,
}: {
  id: string;
  state: FeedbackState;
  name: string;
}) {
  const message = state.fieldErrors?.[name];
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-danger-foreground">
      {message}
    </p>
  );
}

/** Error summary (role=alert) and success message (role=status) for a form. */
export function FormFeedback({
  state,
  dismissed = false,
}: {
  state: FeedbackState;
  dismissed?: boolean;
}) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
      {state.success && !state.error && !dismissed ? (
        <p role="status" className="w-full text-sm text-success-600">
          {state.success}
        </p>
      ) : null}
    </>
  );
}

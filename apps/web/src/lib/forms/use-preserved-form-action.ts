"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

export type PreservedFormOptions<S> = {
  /** Defines "success" from the state shape. Default: the state has no truthy `error` and no non-empty `fieldErrors`. */
  isSuccess?: (state: S) => boolean;
  /** Reset the form fields after a successful result (default: true). */
  resetOnSuccess?: boolean;
};

function defaultIsSuccess(state: unknown): boolean {
  if (!state || typeof state !== "object") return true;
  const { error, fieldErrors } = state as { error?: unknown; fieldErrors?: unknown };
  if (error) return false;
  if (fieldErrors && typeof fieldErrors === "object" && Object.keys(fieldErrors).length > 0) {
    return false;
  }
  return true;
}

/**
 * Drop-in replacement for `<form action={formAction}>` with `useActionState`.
 *
 * React 19 resets all uncontrolled fields of a form whose `action` prop finished,
 * even if the action returned a validation error - users lose what they typed.
 * This hook instead handles `onSubmit` itself: it prevents the native submit,
 * calls the action inside a transition with the form's FormData (so React's
 * automatic reset never runs) and calls `form.reset()` only on success.
 *
 * Usage: `<form onSubmit={onSubmit}>`.
 */
export function usePreservedFormAction<S>(
  action: (previous: S, formData: FormData) => Promise<S> | S,
  initialState: S,
  options: PreservedFormOptions<S> = {},
): [state: S, onSubmit: (event: FormEvent<HTMLFormElement>) => void, isPending: boolean] {
  const { isSuccess = defaultIsSuccess, resetOnSuccess = true } = options;
  const formRef = useRef<HTMLFormElement | null>(null);
  const resetPending = useRef(false);
  const isSuccessRef = useRef(isSuccess);
  useEffect(() => {
    isSuccessRef.current = isSuccess;
  });

  const [state, formAction, isPending] = useActionState<unknown, FormData>(
    async (previous, formData) => {
      const next = await action(previous as S, formData);
      resetPending.current = resetOnSuccess && isSuccessRef.current(next);
      return next;
    },
    initialState,
  );

  useEffect(() => {
    if (resetPending.current) {
      resetPending.current = false;
      formRef.current?.reset();
    }
  }, [state]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    formRef.current = form;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as
      HTMLButtonElement | HTMLInputElement | null;
    let formData: FormData;
    try {
      formData = submitter ? new FormData(form, submitter) : new FormData(form);
    } catch {
      formData = new FormData(form);
    }
    startTransition(() => {
      formAction(formData);
    });
  };

  return [state as S, onSubmit, isPending];
}

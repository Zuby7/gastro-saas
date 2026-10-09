"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

export type PreservedFormProps = {
  action: (formData: FormData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export type PreservedFormOptions<S> = {
  /** Defines "success" from the state shape. Default: the state has no truthy `error` and no non-empty `fieldErrors`. */
  isSuccess?: (state: S) => boolean;
  /** Reset the form fields after a successful result (default: true). */
  resetOnSuccess?: boolean;
  /** Field names (e.g. passwords) that are cleared when the result is NOT a success. */
  clearOnError?: string[];
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
 * Usage: `const [state, formProps] = usePreservedFormAction(...)` then `<form {...formProps}>`
 * (spread both props; never use `onSubmit` alone).
 */
export function usePreservedFormAction<S>(
  action: (previous: S, formData: FormData) => Promise<S> | S,
  initialState: S,
  options: PreservedFormOptions<S> = {},
): [state: S, formProps: PreservedFormProps, isPending: boolean] {
  const { isSuccess = defaultIsSuccess, resetOnSuccess = true, clearOnError } = options;
  const formRef = useRef<HTMLFormElement | null>(null);
  const resetPending = useRef(false);
  const clearPending = useRef(false);
  const isSuccessRef = useRef(isSuccess);
  useEffect(() => {
    isSuccessRef.current = isSuccess;
  });

  const [state, formAction, isPending] = useActionState<unknown, FormData>(
    async (previous, formData) => {
      const next = await action(previous as S, formData);
      const ok = isSuccessRef.current(next);
      resetPending.current = resetOnSuccess && ok;
      clearPending.current = !ok && !!clearOnError?.length;
      return next;
    },
    initialState,
  );

  useEffect(() => {
    if (resetPending.current) {
      resetPending.current = false;
      formRef.current?.reset();
    }
    if (clearPending.current) {
      clearPending.current = false;
      for (const name of clearOnError ?? []) {
        const field = formRef.current?.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.value = "";
      }
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

  // `action` stays next to `onSubmit`: with JS it is skipped (onSubmit calls
  // preventDefault, so React never auto-resets), but before hydration / without
  // JS the browser POSTs to the server action instead of a GET that would leak
  // typed values into the URL.
  return [state as S, { action: formAction, onSubmit }, isPending];
}

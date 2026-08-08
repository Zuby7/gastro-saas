"use client";

import { useActionState } from "react";
import { publishAction, runPublishChecksAction, type PublishState } from "./actions";

const initialState: PublishState = {};

export function PublishPanel({ menuVersionId }: { menuVersionId: string }) {
  const [checkState, runChecksFormAction, isCheckPending] = useActionState(
    runPublishChecksAction,
    initialState,
  );
  const [publishState, publishFormAction, isPublishPending] = useActionState(
    publishAction,
    initialState,
  );

  const blockers = checkState.checks?.filter((check) => check.severity === "blocker") ?? [];
  const warnings = checkState.checks?.filter((check) => check.severity === "warning") ?? [];
  const hasRunChecks = Boolean(checkState.checks);
  const canPublish = hasRunChecks && blockers.length === 0;

  return (
    <section
      aria-labelledby="publish-heading"
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm"
    >
      <h2 id="publish-heading" className="text-lg font-semibold text-foreground">
        Vorschau &amp; Veröffentlichen
      </h2>
      <p className="text-sm text-foreground-secondary">
        Änderungen am Entwurf wirken sich nicht auf die live veröffentlichte Speisekarte aus, bis
        Sie veröffentlichen.
      </p>

      <form action={runChecksFormAction}>
        <input type="hidden" name="menuVersionId" value={menuVersionId} />
        <button
          type="submit"
          disabled={isCheckPending}
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-foreground transition-colors hover:border-brand-500 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {isCheckPending ? "Wird geprüft…" : "Qualitätsprüfung ausführen"}
        </button>
      </form>

      {checkState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {checkState.error}
        </p>
      ) : null}

      {hasRunChecks ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          <div
            className={
              blockers.length > 0
                ? "rounded-lg border-2 border-danger-500 bg-danger-500/10 p-3"
                : "rounded-lg border border-neutral-200 p-3"
            }
          >
            <h3
              className={
                blockers.length > 0 ? "font-semibold text-danger-600" : "font-semibold text-foreground"
              }
            >
              Blocker {blockers.length > 0 ? `(${blockers.length})` : "(keine)"}
            </h3>
            {blockers.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {blockers.map((check) => (
                  <li
                    key={check.code}
                    role="alert"
                    className="rounded-md border border-danger-500 bg-neutral-0 p-2 text-sm font-medium text-danger-600"
                  >
                    {check.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-foreground-secondary">
                Keine Blocker gefunden -- die Speisekarte kann veröffentlicht werden.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 p-3">
            <h3
              className={
                warnings.length > 0 ? "font-medium text-warning-600" : "font-medium text-foreground"
              }
            >
              Warnungen {warnings.length > 0 ? `(${warnings.length})` : "(keine)"}
            </h3>
            {warnings.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {warnings.map((check) => (
                  <li
                    key={check.code}
                    className="rounded-md border border-warning-500 bg-warning-500/10 p-2 text-sm text-warning-600"
                  >
                    {check.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-foreground-secondary">Keine Warnungen.</p>
            )}
          </div>
        </div>
      ) : null}

      <form action={publishFormAction}>
        <input type="hidden" name="menuVersionId" value={menuVersionId} />
        <button
          type="submit"
          disabled={!canPublish || isPublishPending}
          aria-disabled={!canPublish}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
        >
          {isPublishPending ? "Wird veröffentlicht…" : "Veröffentlichen"}
        </button>
        {!hasRunChecks ? (
          <p className="mt-2 text-sm text-foreground-secondary">
            Bitte führen Sie zuerst die Qualitätsprüfung aus.
          </p>
        ) : null}
        {hasRunChecks && !canPublish ? (
          <p className="mt-2 text-sm text-danger-600">
            Veröffentlichung ist gesperrt, solange Blocker bestehen.
          </p>
        ) : null}
      </form>

      {publishState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {publishState.error}
        </p>
      ) : null}
      {publishState.success ? (
        <p role="status" aria-live="polite" className="text-sm text-success-600">
          {publishState.success}
        </p>
      ) : null}
    </section>
  );
}

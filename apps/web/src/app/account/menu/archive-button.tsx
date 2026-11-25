"use client";

import { useState } from "react";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

/**
 * Two-step archive control: "Archivieren" first only asks for confirmation,
 * the submit button ("Wirklich archivieren?") then posts the surrounding form.
 * Render it inside the `<form>` that carries the hidden id field.
 */
export function ArchiveButton({ itemLabel }: { itemLabel: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`${itemLabel} archivieren`}
        className={`rounded-md border border-danger-500 px-2 py-1 text-sm text-danger-foreground ${FOCUS}`}
      >
        Archivieren
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="submit"
        autoFocus
        aria-label={`${itemLabel} wirklich archivieren`}
        className={`rounded-md border-2 border-danger-500 bg-danger-500/10 px-2 py-1 text-sm font-medium text-danger-foreground ${FOCUS}`}
      >
        Wirklich archivieren?
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className={`rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground ${FOCUS}`}
      >
        Abbrechen
      </button>
    </span>
  );
}

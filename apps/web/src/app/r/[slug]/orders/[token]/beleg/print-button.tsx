"use client";

/** Opens the browser print dialog (also offers "Save as PDF"); hidden on paper via `print:hidden`. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="self-start rounded-md bg-ember-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600 print:hidden"
    >
      Beleg drucken / als PDF speichern
    </button>
  );
}

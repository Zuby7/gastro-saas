"use client";

import { useActionState } from "react";
import { analyzeImportFileAction, confirmImportAction, type ImportActionState } from "./actions";

const initialState: ImportActionState = {};

const FIELD_OPTIONS = [
  { key: "dishColumn", label: "Gericht (Spalte)", required: true },
  { key: "quantityColumn", label: "Menge (Spalte)", required: true },
  { key: "dateColumn", label: "Datum (Spalte)", required: true },
  { key: "channelColumn", label: "Kanal/Quelle (Spalte, optional)", required: false },
] as const;

/**
 * Ticket #59 ("Excel-Import für historische Verkaufsdaten"): two-step
 * upload -> preview/column-mapping -> confirm flow. Step 1
 * (`analyzeImportFileAction`) parses the file and stages it server-side;
 * step 2 (`confirmImportAction`) re-validates every row against the
 * chosen column mapping and only then bulk-inserts into
 * `manual_sales_entries` (ticket #58's table) -- never partially, and
 * never trusting anything about validity from step 1's preview alone.
 */
export function SalesImportClient() {
  const [analyzeState, analyzeFormAction, isAnalyzing] = useActionState(
    analyzeImportFileAction,
    initialState,
  );
  const [confirmState, confirmFormAction, isConfirming] = useActionState(
    confirmImportAction,
    initialState,
  );

  const analyzed = analyzeState.analyzed;
  // Only show the mapping form for the batch actually staged by the LATEST
  // analyze call -- if the user analyzes a new file after a completed (or
  // failed) confirm of an older batch, that older confirm's leftover state
  // must not keep the (now-stale) mapping form hidden or the wrong result
  // banner visible.
  const confirmIsForCurrentBatch =
    analyzed && confirmState.confirmedForBatchId === analyzed.batchId;
  const showMapping =
    Boolean(analyzed) && !(confirmIsForCurrentBatch && confirmState.importedCount !== undefined);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="import-upload-heading"
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm"
      >
        <h2 id="import-upload-heading" className="text-lg font-semibold text-foreground">
          1. Datei hochladen
        </h2>
        <p className="text-sm text-foreground-secondary">
          .xlsx- oder .csv-Datei mit historischen Verkaufsdaten (max. 5 MB, max. 2000 Zeilen). Diese
          Daten fließen als manuell nachgetragene Verkäufe in die Analytics ein -- wie Ticket #58,
          nur gebulkt.
        </p>

        {!showMapping && analyzeState.error ? (
          <p role="alert" className="text-sm text-danger-600">
            {analyzeState.error}
          </p>
        ) : null}

        <form action={analyzeFormAction} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="import-file" className="text-sm font-medium text-foreground">
              Datei
            </label>
            <input
              id="import-file"
              name="file"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className="text-sm text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={isAnalyzing}
            className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
          >
            {isAnalyzing ? "Wird analysiert…" : "Datei analysieren"}
          </button>
        </form>
      </section>

      {showMapping && analyzed ? (
        <section
          aria-labelledby="import-mapping-heading"
          className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm"
        >
          <h2 id="import-mapping-heading" className="text-lg font-semibold text-foreground">
            2. Spalten zuordnen &amp; Vorschau
          </h2>
          <p className="text-sm text-foreground-secondary">
            &quot;{analyzed.originalFilename}&quot; -- {analyzed.rowCount} Datenzeile(n) gefunden.
          </p>

          {confirmIsForCurrentBatch && confirmState.error ? (
            <div role="alert" className="flex flex-col gap-2 text-sm text-danger-600">
              <p>{confirmState.error}</p>
              {confirmState.rowErrors && confirmState.rowErrors.length > 0 ? (
                <ul className="list-inside list-disc">
                  {confirmState.rowErrors.slice(0, 20).map((rowError) => (
                    <li key={rowError.rowNumber}>
                      Zeile {rowError.rowNumber}: {rowError.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground">
              <caption className="sr-only">
                Vorschau der ersten Zeilen der hochgeladenen Datei
              </caption>
              <thead>
                <tr>
                  {analyzed.headers.map((header) => (
                    <th key={header} scope="col" className="py-1 pr-4 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analyzed.previewRows.map((row, index) => (
                  <tr key={`preview-row-${index}`} className="border-t border-neutral-200">
                    {analyzed.headers.map((header) => (
                      <td key={header} className="py-1 pr-4">
                        {row[header] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={confirmFormAction} className="flex flex-col gap-4">
            <input type="hidden" name="batchId" value={analyzed.batchId} />
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELD_OPTIONS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label
                    htmlFor={`import-mapping-${field.key}`}
                    className="text-sm font-medium text-foreground"
                  >
                    {field.label}
                  </label>
                  <select
                    id={`import-mapping-${field.key}`}
                    name={field.key}
                    required={field.required}
                    defaultValue=""
                    className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
                  >
                    <option value="" disabled>
                      Bitte wählen…
                    </option>
                    {analyzed.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  {confirmIsForCurrentBatch && confirmState.fieldErrors?.[field.key] ? (
                    <span className="text-xs text-danger-600">
                      {confirmState.fieldErrors[field.key]}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={isConfirming}
              className="w-fit rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
            >
              {isConfirming ? "Wird importiert…" : "Import bestätigen"}
            </button>
          </form>
        </section>
      ) : null}

      {confirmIsForCurrentBatch &&
      confirmState.success &&
      confirmState.importedCount !== undefined ? (
        <p role="status" className="text-sm text-success-600">
          {confirmState.success}
        </p>
      ) : null}
    </div>
  );
}

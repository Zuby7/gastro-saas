"use client";

import { useActionState } from "react";
import { recordManualSaleAction, type DishActionState } from "./actions";

const initialState: DishActionState = {};

export interface ManualSaleEntryRecord {
  id: string;
  quantity: number;
  sale_date: string;
  channel: string | null;
  created_at: string;
}

export interface ManualSalesSectionProps {
  dishId: string;
  entries: ManualSaleEntryRecord[];
}

function formatDate(dateString: string): string {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("de-DE");
}

/**
 * Ticket #58 ("Manuelle Nacherfassung von Verkäufen"): lets an authorized
 * staff member log a sale of this dish that happened outside this
 * platform's own order/payment system (e.g. Lieferando, walk-in without the
 * ordering system). Explicitly labeled throughout as "außerhalb des
 * Bestellsystems" / manually entered, never presented alongside or blended
 * with real order data -- this section only ever reads/writes the
 * dedicated `manual_sales_entries` table.
 */
export function ManualSalesSection({ dishId, entries }: ManualSalesSectionProps) {
  const [state, formAction, isPending] = useActionState(recordManualSaleAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section
      aria-labelledby="manual-sales-heading"
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm"
    >
      <h2 id="manual-sales-heading" className="text-lg font-semibold text-foreground">
        Verkäufe nachtragen
      </h2>
      <p className="text-sm text-foreground-secondary">
        Nur für Verkäufe außerhalb unseres Bestellsystems (z. B. Lieferando, vor Ort ohne
        Bestellsystem). Diese Einträge fließen als klar gekennzeichnete, zusätzliche Kennzahlen in
        die Analytics ein -- sie werden nie mit echten, über diese Plattform bezahlten Bestellungen
        vermischt.
      </p>

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

      <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
        <input type="hidden" name="dishId" value={dishId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-sale-quantity" className="text-sm font-medium text-foreground">
            Anzahl
          </label>
          <input
            id="manual-sale-quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            defaultValue={1}
            className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.quantity ? (
            <span className="text-xs text-danger-600">{state.fieldErrors.quantity}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="manual-sale-date" className="text-sm font-medium text-foreground">
            Datum
          </label>
          <input
            id="manual-sale-date"
            name="saleDate"
            type="date"
            required
            max={today}
            defaultValue={today}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.saleDate ? (
            <span className="text-xs text-danger-600">{state.fieldErrors.saleDate}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="manual-sale-channel" className="text-sm font-medium text-foreground">
            Kanal/Quelle (optional)
          </label>
          <input
            id="manual-sale-channel"
            name="channel"
            type="text"
            placeholder="z. B. Lieferando, Vor Ort"
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.channel ? (
            <span className="text-xs text-danger-600">{state.fieldErrors.channel}</span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Wird gespeichert…" : "Verkauf nachtragen"}
        </button>
      </form>

      {entries.length > 0 ? (
        <table className="w-full text-left text-sm text-foreground">
          <caption className="sr-only">Zuletzt nachgetragene Verkäufe für dieses Gericht</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1">
                Datum
              </th>
              <th scope="col" className="py-1">
                Anzahl
              </th>
              <th scope="col" className="py-1">
                Kanal/Quelle
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-neutral-200">
                <td className="py-1">{formatDate(entry.sale_date)}</td>
                <td className="py-1">{entry.quantity}</td>
                <td className="py-1">{entry.channel ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-foreground-secondary">Noch keine manuellen Verkäufe erfasst.</p>
      )}
    </section>
  );
}

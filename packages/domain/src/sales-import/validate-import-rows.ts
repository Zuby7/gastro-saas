// Ticket #59 ("Excel-Import für historische Verkaufsdaten"): pure,
// framework-free validation/mapping logic for one parsed spreadsheet's worth
// of historical sales rows, shared between the preview step (surfacing
// row-level errors before anything is written) and the confirm step (which
// re-runs this exact same validation server-side -- never trusts the
// client's own idea of which rows are valid).
//
// Deliberately mirrors ticket #58's `ManualSaleEntrySchema` bounds (same
// quantity range, same "not in the future" rule) since a committed row ends
// up as a `manual_sales_entries` row too -- just bulk-inserted instead of
// entered one at a time. "keine kaputten Zeilen einfach durchwinken" (the
// ticket's own non-goal wording) is interpreted as strict, all-or-nothing:
// ANY row error means nothing from this batch is imported until the source
// file is fixed and re-analyzed.

export const MAX_IMPORT_ROWS = 2000;

export const MAX_QUANTITY = 100_000;

export interface ColumnMapping {
  dishColumn: string;
  quantityColumn: string;
  dateColumn: string;
  channelColumn?: string;
}

export interface ImportRowInput {
  /** 1-based row number as it appears in the source file, excluding the header row -- used in error messages so a user can find the row in their spreadsheet. */
  rowNumber: number;
  /** Raw cell values keyed by column header, already stringified (dates as ISO `yyyy-mm-dd` if the parser could tell it was a date cell, otherwise the literal cell text). */
  cells: Record<string, string>;
}

export interface ValidatedImportRow {
  rowNumber: number;
  dishId: string;
  dishName: string;
  quantity: number;
  saleDate: string;
  channel: string | null;
}

export interface ImportRowError {
  rowNumber: number;
  message: string;
}

export interface ValidateImportRowsResult {
  validRows: ValidatedImportRow[];
  errors: ImportRowError[];
}

const GERMAN_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses either `yyyy-mm-dd` (ISO, what our own date-typed cells and HTML
 * date inputs use) or `dd.mm.yyyy` (the common German-locale spreadsheet
 * format we can expect from a gastro POS export) into an ISO `yyyy-mm-dd`
 * string. Returns null for anything else -- deliberately narrow rather than
 * a permissive `new Date(str)` parse, which silently accepts ambiguous
 * formats (is "01/02/2026" January 2nd or February 1st?).
 */
function parseSaleDate(raw: string): string | null {
  const value = raw.trim();

  const isoMatch = ISO_DATE_RE.exec(value);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return `${year}-${month}-${day}`;
  }

  const germanMatch = GERMAN_DATE_RE.exec(value);
  if (germanMatch) {
    const [, day, month, year] = germanMatch;
    const paddedMonth = (month ?? "").padStart(2, "0");
    const paddedDay = (day ?? "").padStart(2, "0");
    const date = new Date(`${year}-${paddedMonth}-${paddedDay}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return `${year}-${paddedMonth}-${paddedDay}`;
  }

  return null;
}

function normalizeDishName(name: string): string {
  return name.trim().toLowerCase();
}

export function validateImportRows(
  rows: ImportRowInput[],
  mapping: ColumnMapping,
  /** Normalized (trim + lowercase) dish name -> dish id, scoped to the caller's own tenant. */
  dishLookup: Map<string, string>,
): ValidateImportRowsResult {
  const validRows: ValidatedImportRow[] = [];
  const errors: ImportRowError[] = [];

  for (const row of rows) {
    const rawDishName = (row.cells[mapping.dishColumn] ?? "").trim();
    const rawQuantity = (row.cells[mapping.quantityColumn] ?? "").trim();
    const rawDate = (row.cells[mapping.dateColumn] ?? "").trim();
    const rawChannel = mapping.channelColumn ? (row.cells[mapping.channelColumn] ?? "").trim() : "";

    if (!rawDishName) {
      errors.push({ rowNumber: row.rowNumber, message: "Gericht fehlt." });
      continue;
    }

    const dishId = dishLookup.get(normalizeDishName(rawDishName));
    if (!dishId) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Gericht "${rawDishName}" wurde nicht gefunden (Name muss exakt mit einem Gericht auf Ihrer Speisekarte übereinstimmen).`,
      });
      continue;
    }

    if (!/^\d+$/.test(rawQuantity)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Ungültige Anzahl "${rawQuantity}" (muss eine ganze Zahl sein).`,
      });
      continue;
    }
    const quantity = Number(rawQuantity);
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Anzahl ${quantity} liegt außerhalb des gültigen Bereichs (1-${MAX_QUANTITY}).`,
      });
      continue;
    }

    const saleDate = parseSaleDate(rawDate);
    if (!saleDate) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Ungültiges Datum "${rawDate}" (erwartet: JJJJ-MM-TT oder TT.MM.JJJJ).`,
      });
      continue;
    }
    if (new Date(`${saleDate}T00:00:00Z`).getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Datum "${rawDate}" liegt in der Zukunft.`,
      });
      continue;
    }

    if (rawChannel.length > 100) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Kanal/Quelle ist zu lang (max. 100 Zeichen).",
      });
      continue;
    }

    validRows.push({
      rowNumber: row.rowNumber,
      dishId,
      dishName: rawDishName,
      quantity,
      saleDate,
      channel: rawChannel || null,
    });
  }

  return { validRows, errors };
}

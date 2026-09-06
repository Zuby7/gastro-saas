import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { ImportRowInput } from "@gastro-saas/domain";

export interface ParsedSalesFile {
  headers: string[];
  rows: ImportRowInput[];
}

export class SalesFileParseError extends Error {}

/**
 * Ticket #59: parses an uploaded .xlsx/.csv buffer into a header row +
 * data rows (raw, not-yet-validated cell text) using ExcelJS, which reads
 * both formats through the same worksheet API (`workbook.csv.read()` for
 * CSV, `workbook.xlsx.load()` for .xlsx) -- so this file is the only place
 * that needs to know the two formats' cells arrive slightly differently
 * (date cells are native `Date` objects for .xlsx but plain strings for
 * CSV).
 *
 * Never throws on malformed *data* -- that's `validateImportRows()`'s job,
 * running against the returned rows. This only throws
 * `SalesFileParseError` for a file ExcelJS can't parse as a workbook/CSV at
 * all (wrong format, corrupted file), or one with no header row / no data
 * rows / more rows than `maxRows` -- structural problems a column mapping
 * can't fix.
 */
export async function parseSalesFile(
  buffer: Buffer,
  filename: string,
  maxRows: number,
): Promise<ParsedSalesFile> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith(".csv");

  let worksheet: ExcelJS.Worksheet | undefined;
  try {
    if (isCsv) {
      worksheet = await workbook.csv.read(Readable.from(buffer));
    } else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      worksheet = workbook.worksheets[0];
    }
  } catch {
    throw new SalesFileParseError(
      "Die Datei konnte nicht gelesen werden. Bitte prüfen Sie das Dateiformat.",
    );
  }

  if (!worksheet || worksheet.rowCount === 0) {
    throw new SalesFileParseError("Die Datei enthält keine lesbaren Daten.");
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = cellToString(cell.value).trim();
    if (value) headers[colNumber - 1] = value;
  });

  const nonEmptyHeaders = headers.filter((header): header is string => Boolean(header));
  if (nonEmptyHeaders.length === 0) {
    throw new SalesFileParseError("Die Datei enthält keine Kopfzeile (Spaltennamen).");
  }

  const rows: ImportRowInput[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const cells: Record<string, string> = {};
    let hasAnyValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const raw = cellToString(row.getCell(index + 1).value);
      if (raw) hasAnyValue = true;
      cells[header] = raw;
    });

    if (!hasAnyValue) return; // skip fully blank rows (common trailing rows in exports)

    rows.push({ rowNumber: rowNumber - 1, cells });
  });

  if (rows.length === 0) {
    throw new SalesFileParseError("Die Datei enthält keine Datenzeilen.");
  }

  if (rows.length > maxRows) {
    throw new SalesFileParseError(
      `Die Datei enthält ${rows.length} Zeilen -- das Limit liegt bei ${maxRows}. Bitte teilen Sie den Import auf.`,
    );
  }

  return { headers: nonEmptyHeaders, rows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Use LOCAL date components, not `toISOString()` (UTC) -- ExcelJS
    // constructs date cells (for both .xlsx date-typed cells and CSV's
    // date-string auto-detection) as a local-midnight `Date`, so converting
    // via UTC can shift the date backward/forward by a day depending on the
    // server's timezone offset.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return "";
  }
  return String(value).trim();
}

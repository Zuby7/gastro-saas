import { z } from "zod";

/**
 * Ticket #59: allow-listed upload types + size limit for the historical
 * sales import file, per `.claude/rules/security.md`'s file-upload rules --
 * mirrors ticket #12's `ALLOWED_IMAGE_TYPES`/`MAX_IMAGE_SIZE_BYTES` pattern
 * in `apps/web/src/app/account/menu/dishes/[dishId]/schemas.ts`. Checked
 * against BOTH the browser-reported MIME type and the filename extension
 * (`isAllowedImportFile` below) -- neither alone is trustworthy (a browser
 * can report an empty/generic MIME type for CSV on some platforms, and a
 * MIME type alone can be spoofed).
 */
export const ALLOWED_IMPORT_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel", // some browsers report this for .csv
  "application/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
] as const;

export const ALLOWED_IMPORT_EXTENSIONS = [".csv", ".xlsx"] as const;

export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function isAllowedImportFile(file: { name: string; type: string }): boolean {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_IMPORT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!hasAllowedExtension) return false;

  // An empty MIME type (browser couldn't infer one) is tolerated as long as
  // the extension is allow-listed -- the file's actual bytes are still
  // parsed strictly by ExcelJS server-side afterward, which rejects
  // anything that isn't a well-formed workbook/CSV regardless of what the
  // client claimed.
  if (file.type === "") return true;

  return (ALLOWED_IMPORT_MIME_TYPES as readonly string[]).includes(file.type);
}

export const ColumnMappingSchema = z
  .object({
    dishColumn: z.string().trim().min(1, "Bitte wählen Sie die Spalte für das Gericht."),
    quantityColumn: z.string().trim().min(1, "Bitte wählen Sie die Spalte für die Menge."),
    dateColumn: z.string().trim().min(1, "Bitte wählen Sie die Spalte für das Datum."),
    channelColumn: z.string().trim().optional().or(z.literal("")),
  })
  .transform((data) => ({
    dishColumn: data.dishColumn,
    quantityColumn: data.quantityColumn,
    dateColumn: data.dateColumn,
    channelColumn: data.channelColumn || undefined,
  }));

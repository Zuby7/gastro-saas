"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateImportRows, MAX_IMPORT_ROWS, type ImportRowInput } from "@gastro-saas/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { parseSalesFile, SalesFileParseError } from "@/lib/import/parse-sales-file";
import { ColumnMappingSchema, MAX_IMPORT_FILE_SIZE_BYTES, isAllowedImportFile } from "./schemas";

export interface ImportActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** Present after a successful analyze step -- feeds the column-mapping UI. */
  analyzed?: {
    batchId: string;
    headers: string[];
    previewRows: Array<Record<string, string>>;
    rowCount: number;
    originalFilename: string;
  };
  /** Present after a confirm step that found invalid rows -- nothing was imported. */
  rowErrors?: Array<{ rowNumber: number; message: string }>;
  importedCount?: number;
  /** Echoes the batchId a confirm attempt was for, success or failure -- lets the UI tell "still mapping this batch" apart from "started analyzing a new file". */
  confirmedForBatchId?: string;
}

async function requireImportContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    throw new Error("Sie sind noch keinem Restaurant zugeordnet.");
  }

  return { supabase, user, tenantId: membership.tenantId };
}

async function ensureImportPermission(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<ImportActionState | null> {
  try {
    await requireTenantPermission(supabase, tenantId, "analytics.manualsales.write");
    return null;
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, Verkaufsdaten zu importieren.",
      };
    }
    throw error;
  }
}

/**
 * Ticket #59, step 1 ("analyze"): validates the uploaded file
 * (allow-listed type + size, per `.claude/rules/security.md`), parses it
 * server-side, and stages its header row + raw (not-yet-validated) data
 * rows in `sales_import_batches` -- scoped to the caller's own tenant by
 * both this explicit filter and the table's own RLS. Returns only a
 * preview (first 20 rows) plus the batch id; the confirm step
 * (`confirmImportAction`) re-reads the full staged rows by that id rather
 * than trusting anything resubmitted by the client.
 */
export async function analyzeImportFileAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte wählen Sie eine Datei aus." };
  }

  if (!isAllowedImportFile({ name: file.name, type: file.type })) {
    return { error: "Nur .xlsx- oder .csv-Dateien sind erlaubt." };
  }

  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { error: "Die Datei darf höchstens 5 MB groß sein." };
  }

  const { supabase, tenantId, user } = await requireImportContext();
  const denied = await ensureImportPermission(supabase, tenantId);
  if (denied) return denied;

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = await parseSalesFile(buffer, file.name, MAX_IMPORT_ROWS);
  } catch (error) {
    if (error instanceof SalesFileParseError) {
      return { error: error.message };
    }
    return { error: "Die Datei konnte nicht gelesen werden." };
  }

  const { data: batch, error: insertError } = await supabase
    .from("sales_import_batches")
    .insert({
      tenant_id: tenantId,
      created_by_user_id: user?.id ?? null,
      original_filename: file.name.slice(0, 255),
      headers: parsed.headers,
      rows: parsed.rows,
      row_count: parsed.rows.length,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !batch) {
    return { error: "Der Import konnte nicht vorbereitet werden." };
  }

  return {
    analyzed: {
      batchId: batch.id,
      headers: parsed.headers,
      previewRows: parsed.rows.slice(0, 20).map((row) => row.cells),
      rowCount: parsed.rows.length,
      originalFilename: file.name,
    },
  };
}

/**
 * Ticket #59, step 2 ("confirm"): given a previously staged batch id and a
 * column mapping, re-validates EVERY row server-side
 * (`validateImportRows()` -- the exact same pure logic ticket #58's
 * single-entry form's schema bounds are built on) and only bulk-inserts
 * into `manual_sales_entries` if every row is valid. Any invalid row means
 * NOTHING is imported ("keine kaputten Zeilen einfach durchwinken") -- the
 * caller sees every row's error and must fix the source file.
 */
export async function confirmImportAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) {
    return { error: "Ungültige Anfrage." };
  }

  const parsedMapping = ColumnMappingSchema.safeParse({
    dishColumn: formData.get("dishColumn"),
    quantityColumn: formData.get("quantityColumn"),
    dateColumn: formData.get("dateColumn"),
    channelColumn: formData.get("channelColumn") ?? "",
  });

  if (!parsedMapping.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsedMapping.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string") fieldErrors[field] = issue.message;
    }
    return {
      error: "Bitte ordnen Sie alle erforderlichen Spalten zu.",
      fieldErrors,
      confirmedForBatchId: batchId,
    };
  }

  const { supabase, tenantId, user } = await requireImportContext();
  const denied = await ensureImportPermission(supabase, tenantId);
  if (denied) return { ...denied, confirmedForBatchId: batchId };

  const { data: batchRow } = await supabase
    .from("sales_import_batches")
    .select("id, headers, rows, original_filename")
    .eq("id", batchId)
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .maybeSingle<{
      id: string;
      headers: string[];
      rows: ImportRowInput[];
      original_filename: string;
    }>();

  if (!batchRow) {
    return {
      error: "Import wurde nicht gefunden oder ist bereits abgeschlossen.",
      confirmedForBatchId: batchId,
    };
  }

  const mapping = parsedMapping.data;
  const headerSet = new Set(batchRow.headers);
  for (const column of [mapping.dishColumn, mapping.quantityColumn, mapping.dateColumn]) {
    if (!headerSet.has(column)) {
      return {
        error: "Die Spaltenzuordnung passt nicht zur hochgeladenen Datei.",
        confirmedForBatchId: batchId,
      };
    }
  }
  if (mapping.channelColumn && !headerSet.has(mapping.channelColumn)) {
    return {
      error: "Die Spaltenzuordnung passt nicht zur hochgeladenen Datei.",
      confirmedForBatchId: batchId,
    };
  }

  // Scoped to the tenant's CURRENTLY PUBLISHED menu version -- mirrors
  // get_dish_performance_stats()'s own scoping (only the published version's
  // dishes are ever reported there). Matching against dishes across every
  // menu version (draft, older published versions still on disk, etc.)
  // could resolve a repeated dish name to the wrong/older dish id, which
  // then silently never shows up in dish-performance stats once it doesn't
  // belong to the current published version.
  const { data: publishedVersion } = await supabase
    .from("menu_versions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!publishedVersion) {
    return {
      error:
        "Es gibt noch keine veröffentlichte Speisekarte -- ein Import kann erst nach der ersten Veröffentlichung zugeordnet werden.",
      confirmedForBatchId: batchId,
    };
  }

  const { data: dishes } = await supabase
    .from("dishes")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("menu_version_id", publishedVersion.id)
    .is("archived_at", null)
    .returns<Array<{ id: string; name: string }>>();

  const dishNameCounts = new Map<string, number>();
  for (const dish of dishes ?? []) {
    const key = dish.name.trim().toLowerCase();
    dishNameCounts.set(key, (dishNameCounts.get(key) ?? 0) + 1);
  }
  const ambiguousDishNames = [...dishNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  const dishLookup = new Map<string, string>();
  for (const dish of dishes ?? []) {
    const key = dish.name.trim().toLowerCase();
    if (dishNameCounts.get(key)! > 1) continue; // ambiguous -- never guess which one
    dishLookup.set(key, dish.id);
  }

  const { validRows, errors } = validateImportRows(batchRow.rows, mapping, dishLookup);

  // Ambiguous dish names were excluded from dishLookup above, so
  // validateImportRows() already reports every such row as an error --
  // replace its generic "not found" message with an explicit,
  // ambiguity-specific one rather than reporting a misleading "not found"
  // for a dish that does exist (just not uniquely).
  const ambiguousRowNumbers = new Set(
    ambiguousDishNames.length > 0
      ? batchRow.rows
          .filter((row) =>
            ambiguousDishNames.includes(
              String(row.cells[mapping.dishColumn] ?? "")
                .trim()
                .toLowerCase(),
            ),
          )
          .map((row) => row.rowNumber)
      : [],
  );

  const allErrors = errors.map((rowError) =>
    ambiguousRowNumbers.has(rowError.rowNumber)
      ? {
          rowNumber: rowError.rowNumber,
          message:
            "Mehrere Gerichte der veröffentlichten Speisekarte haben denselben Namen -- eine eindeutige Zuordnung ist nicht möglich.",
        }
      : rowError,
  );

  if (allErrors.length > 0) {
    return {
      error: `${allErrors.length} von ${batchRow.rows.length} Zeile(n) sind ungültig. Es wurde nichts importiert -- bitte korrigieren Sie die Datei und laden Sie sie erneut hoch.`,
      rowErrors: allErrors.slice(0, 100),
      confirmedForBatchId: batchId,
    };
  }

  // Atomic claim-then-insert (review finding): commit_sales_import_batch()
  // flips this batch's status from 'pending' to 'committed' and bulk-inserts
  // the validated entries in one transaction, only if the claim actually
  // affected a row -- so two concurrent confirms for the same batch can
  // never both insert (see the migration's own comment for the full race
  // this closes).
  const { data: commitRows, error: commitError } = await supabase.rpc("commit_sales_import_batch", {
    p_tenant_id: tenantId,
    p_batch_id: batchId,
    p_entries: validRows.map((row) => ({
      dishId: row.dishId,
      quantity: row.quantity,
      saleDate: row.saleDate,
      channel: row.channel ?? "",
    })),
    p_entered_by_user_id: user?.id ?? null,
  });

  if (commitError) {
    return { error: "Der Import konnte nicht gespeichert werden.", confirmedForBatchId: batchId };
  }

  const commitResult = (
    commitRows as Array<{ claimed: boolean; imported_count: number }> | null
  )?.[0];

  if (!commitResult?.claimed) {
    return {
      error: "Import wurde nicht gefunden oder ist bereits abgeschlossen.",
      confirmedForBatchId: batchId,
    };
  }

  const importedCount = commitResult.imported_count;

  await recordMenuAdminAuditEvent(supabase, {
    tenantId,
    actorUserId: user?.id ?? null,
    action: "sales_import.committed",
    targetType: "sales_import_batch",
    targetId: batchId,
    metadata: { importedCount, originalFilename: batchRow.original_filename },
  });

  revalidatePath("/account/analytics");
  revalidatePath("/account/analytics/dishes");

  return {
    success: `${importedCount} Verkauf/Verkäufe wurden importiert.`,
    importedCount,
    confirmedForBatchId: batchId,
  };
}

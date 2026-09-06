import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

function membershipTable() {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({
            data: { tenant_id: "tenant-1", role: "owner" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function denyPermission() {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "require_tenant_permission") {
      return { data: null, error: { message: "insufficient_privilege" } };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });
}

function allowPermission() {
  rpcMock.mockImplementation(async () => ({ data: null, error: null }));
}

async function buildXlsxFile(
  name: string,
  header: string[],
  rows: Array<Array<string | number>>,
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(header);
  for (const row of rows) worksheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
  const file = new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // jsdom's File/Blob doesn't implement arrayBuffer() -- same workaround as
  // ticket #12's image-upload test.
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}

function fakeFile(name: string, type: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes);
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") return membershipTable();
    throw new Error(`unexpected table: ${table}`);
  });
});

describe("analyzeImportFileAction", () => {
  it("denies the analyze step when the caller lacks analytics.manualsales.write", async () => {
    denyPermission();
    const fd = new FormData();
    fd.set("file", await buildXlsxFile("sales.xlsx", ["Artikel", "Menge", "Datum"], []));

    const { analyzeImportFileAction } = await import("./actions");
    const result = await analyzeImportFileAction({}, fd);

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(fromMock).not.toHaveBeenCalledWith("sales_import_batches");
  });

  it("rejects a file with a disallowed extension before ever calling the permission RPC", async () => {
    const fd = new FormData();
    fd.set("file", fakeFile("sales.exe", "application/octet-stream", 10));

    const { analyzeImportFileAction } = await import("./actions");
    const result = await analyzeImportFileAction({}, fd);

    expect(result.error).toMatch(/xlsx.*csv/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a file larger than the configured size limit", async () => {
    const fd = new FormData();
    fd.set("file", fakeFile("sales.csv", "text/csv", 6 * 1024 * 1024));

    const { analyzeImportFileAction } = await import("./actions");
    const result = await analyzeImportFileAction({}, fd);

    expect(result.error).toMatch(/5 MB/);
  });

  it("rejects a malformed/corrupted file that ExcelJS cannot parse", async () => {
    allowPermission();
    const fd = new FormData();
    fd.set(
      "file",
      fakeFile(
        "sales.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        20,
      ),
    );

    const { analyzeImportFileAction } = await import("./actions");
    const result = await analyzeImportFileAction({}, fd);

    expect(result.error).toBeDefined();
    expect(fromMock).not.toHaveBeenCalledWith("sales_import_batches");
  });

  it("parses a well-formed file and stages it, returning a preview", async () => {
    allowPermission();
    let insertedRow: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return {
          insert: (row: Record<string, unknown>) => {
            insertedRow = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: "batch-1" }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const fd = new FormData();
    fd.set(
      "file",
      await buildXlsxFile(
        "sales.xlsx",
        ["Artikel", "Menge", "Datum"],
        [["Margherita", 5, "2026-08-01"]],
      ),
    );

    const { analyzeImportFileAction } = await import("./actions");
    const result = await analyzeImportFileAction({}, fd);

    expect(result.analyzed?.batchId).toBe("batch-1");
    expect(result.analyzed?.headers).toEqual(["Artikel", "Menge", "Datum"]);
    expect(result.analyzed?.rowCount).toBe(1);
    expect(insertedRow).toMatchObject({
      tenant_id: "tenant-1",
      original_filename: "sales.xlsx",
      row_count: 1,
    });
  });
});

describe("confirmImportAction", () => {
  const mapping = { dishColumn: "Artikel", quantityColumn: "Menge", dateColumn: "Datum" };

  function baseFormData(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("batchId", "batch-1");
    fd.set("dishColumn", mapping.dishColumn);
    fd.set("quantityColumn", mapping.quantityColumn);
    fd.set("dateColumn", mapping.dateColumn);
    for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
    return fd;
  }

  it("denies confirm when the caller lacks analytics.manualsales.write", async () => {
    denyPermission();
    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(fromMock).not.toHaveBeenCalledWith("sales_import_batches");
  });

  it("rejects when the referenced batch does not belong to the caller's own tenant (cross-tenant isolation)", async () => {
    allowPermission();
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  // simulates RLS/explicit-filter mismatch for another tenant's batch
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.error).toMatch(/nicht gefunden/);
    expect(fromMock).not.toHaveBeenCalledWith("manual_sales_entries");
  });

  function batchTable(rows: Array<{ rowNumber: number; cells: Record<string, string> }>) {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "batch-1",
                  headers: ["Artikel", "Menge", "Datum"],
                  rows,
                  original_filename: "sales.xlsx",
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
  }

  function menuVersionsTable(id = "menu-version-1") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id }, error: null }),
              }),
            }),
          }),
        }),
      }),
    };
  }

  function dishesTable(dishes: Array<{ id: string; name: string }>) {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              // supabase-js chain ends at `.returns<T>()` which is a type-only
              // no-op at runtime -- the actual awaited value is this object.
              returns: () => Promise.resolve({ data: dishes, error: null }),
            }),
          }),
        }),
      }),
    };
  }

  function allowPermissionAndCommit(
    commitResult: { claimed: boolean; imported_count: number } = {
      claimed: true,
      imported_count: 0,
    },
  ) {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "commit_sales_import_batch") return { data: [commitResult], error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
  }

  it("rejects the whole batch (imports nothing) when any row is invalid, reporting every bad row", async () => {
    allowPermissionAndCommit();
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return batchTable([
          { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
          { rowNumber: 2, cells: { Artikel: "Unbekannt", Menge: "1", Datum: "2026-08-01" } },
        ]);
      }
      if (table === "menu_versions") return menuVersionsTable();
      if (table === "dishes") return dishesTable([{ id: "dish-1", name: "Margherita" }]);
      throw new Error(`unexpected table: ${table}`);
    });

    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.error).toMatch(/1 von 2/);
    expect(result.rowErrors).toEqual([
      { rowNumber: 2, message: expect.stringContaining("Unbekannt") },
    ]);
    expect(rpcMock).not.toHaveBeenCalledWith("commit_sales_import_batch", expect.anything());
  });

  it("reports an explicit ambiguous-name error (not a misleading 'not found') when the published menu has two dishes sharing a name", async () => {
    allowPermissionAndCommit();
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return batchTable([
          { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
        ]);
      }
      if (table === "menu_versions") return menuVersionsTable();
      if (table === "dishes") {
        return dishesTable([
          { id: "dish-1", name: "Margherita" },
          { id: "dish-2", name: "Margherita" },
        ]);
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.rowErrors).toEqual([
      { rowNumber: 1, message: expect.stringContaining("Mehrere Gerichte") },
    ]);
    expect(rpcMock).not.toHaveBeenCalledWith("commit_sales_import_batch", expect.anything());
  });

  it("commits the batch via commit_sales_import_batch(), scoped to the current published menu version's dishes", async () => {
    allowPermissionAndCommit({ claimed: true, imported_count: 2 });
    let commitArgs: Record<string, unknown> | undefined;
    rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "commit_sales_import_batch") {
        commitArgs = args;
        return { data: [{ claimed: true, imported_count: 2 }], error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return batchTable([
          { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
          { rowNumber: 2, cells: { Artikel: "Pasta Carbonara", Menge: "2", Datum: "2026-08-02" } },
        ]);
      }
      if (table === "menu_versions") return menuVersionsTable();
      if (table === "dishes") {
        return dishesTable([
          { id: "dish-1", name: "Margherita" },
          { id: "dish-2", name: "Pasta Carbonara" },
        ]);
      }
      if (table === "audit_logs") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.success).toBeDefined();
    expect(result.importedCount).toBe(2);
    expect(commitArgs).toMatchObject({
      p_tenant_id: "tenant-1",
      p_batch_id: "batch-1",
      p_entered_by_user_id: "user-1",
      p_entries: [
        { dishId: "dish-1", quantity: 5, saleDate: "2026-08-01", channel: "" },
        { dishId: "dish-2", quantity: 2, saleDate: "2026-08-02", channel: "" },
      ],
    });
    expect(fromMock).not.toHaveBeenCalledWith("manual_sales_entries");
    expect(fromMock).not.toHaveBeenCalledWith("orders");
    expect(fromMock).not.toHaveBeenCalledWith("payments");
  });

  it("reports 'not found/already completed' when commit_sales_import_batch() could not claim the batch (already committed by a concurrent confirm)", async () => {
    allowPermissionAndCommit({ claimed: false, imported_count: 0 });
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "sales_import_batches") {
        return batchTable([
          { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
        ]);
      }
      if (table === "menu_versions") return menuVersionsTable();
      if (table === "dishes") return dishesTable([{ id: "dish-1", name: "Margherita" }]);
      throw new Error(`unexpected table: ${table}`);
    });

    const { confirmImportAction } = await import("./actions");
    const result = await confirmImportAction({}, baseFormData());

    expect(result.error).toMatch(/nicht gefunden/);
    expect(result.success).toBeUndefined();
  });
});

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSalesFile, SalesFileParseError } from "./parse-sales-file";

async function buildXlsxBuffer(
  header: string[],
  rows: Array<Array<string | number | Date>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(header);
  for (const row of rows) {
    worksheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("parseSalesFile (ticket #59)", () => {
  it("parses a well-formed .xlsx file into headers + rows", async () => {
    const buffer = await buildXlsxBuffer(
      ["Artikel", "Menge", "Datum"],
      [
        ["Margherita", 5, new Date("2026-08-01T00:00:00Z")],
        ["Pasta Carbonara", 2, new Date("2026-08-02T00:00:00Z")],
      ],
    );

    const result = await parseSalesFile(buffer, "export.xlsx", 100);

    expect(result.headers).toEqual(["Artikel", "Menge", "Datum"]);
    expect(result.rows).toEqual([
      { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
      { rowNumber: 2, cells: { Artikel: "Pasta Carbonara", Menge: "2", Datum: "2026-08-02" } },
    ]);
  });

  it("parses a well-formed .csv file into headers + rows", async () => {
    const csv = "Artikel,Menge,Datum\nMargherita,5,2026-08-01\n";
    const buffer = Buffer.from(csv, "utf-8");

    const result = await parseSalesFile(buffer, "export.csv", 100);

    expect(result.headers).toEqual(["Artikel", "Menge", "Datum"]);
    expect(result.rows).toEqual([
      { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
    ]);
  });

  it("skips fully blank trailing rows", async () => {
    const buffer = await buildXlsxBuffer(
      ["Artikel", "Menge", "Datum"],
      [
        ["Margherita", 5, new Date("2026-08-01T00:00:00Z")],
        ["", "", ""],
      ],
    );

    const result = await parseSalesFile(buffer, "export.xlsx", 100);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects a corrupted/unreadable file", async () => {
    const buffer = Buffer.from("this is not a spreadsheet", "utf-8");
    await expect(parseSalesFile(buffer, "export.xlsx", 100)).rejects.toThrow(SalesFileParseError);
  });

  it("rejects a file with no data rows", async () => {
    const buffer = await buildXlsxBuffer(["Artikel", "Menge", "Datum"], []);
    await expect(parseSalesFile(buffer, "export.xlsx", 100)).rejects.toThrow(/keine Datenzeilen/);
  });

  it("rejects a file with more rows than the configured maximum", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`Dish ${i}`, 1, "2026-08-01"]);
    const buffer = await buildXlsxBuffer(["Artikel", "Menge", "Datum"], rows);

    await expect(parseSalesFile(buffer, "export.xlsx", 3)).rejects.toThrow(/Limit liegt bei 3/);
  });
});

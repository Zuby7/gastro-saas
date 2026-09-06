import { describe, expect, it } from "vitest";
import { MAX_QUANTITY, validateImportRows, type ColumnMapping } from "./validate-import-rows";

const mapping: ColumnMapping = {
  dishColumn: "Artikel",
  quantityColumn: "Menge",
  dateColumn: "Datum",
  channelColumn: "Kanal",
};

const dishLookup = new Map<string, string>([
  ["margherita", "dish-1"],
  ["pasta carbonara", "dish-2"],
]);

describe("validateImportRows (ticket #59)", () => {
  it("accepts a well-formed row with an ISO date and resolves the dish by case-insensitive name", () => {
    const { validRows, errors } = validateImportRows(
      [
        {
          rowNumber: 1,
          cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01", Kanal: "Lieferando" },
        },
      ],
      mapping,
      dishLookup,
    );

    expect(errors).toEqual([]);
    expect(validRows).toEqual([
      {
        rowNumber: 1,
        dishId: "dish-1",
        dishName: "Margherita",
        quantity: 5,
        saleDate: "2026-08-01",
        channel: "Lieferando",
      },
    ]);
  });

  it("accepts a German-locale dd.mm.yyyy date", () => {
    const { validRows, errors } = validateImportRows(
      [{ rowNumber: 1, cells: { Artikel: "Margherita", Menge: "2", Datum: "05.08.2026" } }],
      mapping,
      dishLookup,
    );

    expect(errors).toEqual([]);
    expect(validRows[0]?.saleDate).toBe("2026-08-05");
  });

  it("treats a missing optional channel column as null", () => {
    const { validRows } = validateImportRows(
      [{ rowNumber: 1, cells: { Artikel: "Margherita", Menge: "1", Datum: "2026-08-01" } }],
      mapping,
      dishLookup,
    );
    expect(validRows[0]?.channel).toBeNull();
  });

  it("rejects a row whose dish name does not match any of the tenant's own dishes", () => {
    const { validRows, errors } = validateImportRows(
      [
        {
          rowNumber: 3,
          cells: { Artikel: "Unbekanntes Gericht", Menge: "1", Datum: "2026-08-01" },
        },
      ],
      mapping,
      dishLookup,
    );
    expect(validRows).toEqual([]);
    expect(errors).toEqual([
      { rowNumber: 3, message: expect.stringContaining("Unbekanntes Gericht") },
    ]);
  });

  it("rejects a non-integer quantity", () => {
    const { errors } = validateImportRows(
      [{ rowNumber: 2, cells: { Artikel: "Margherita", Menge: "abc", Datum: "2026-08-01" } }],
      mapping,
      dishLookup,
    );
    expect(errors).toEqual([
      { rowNumber: 2, message: expect.stringContaining("Ungültige Anzahl") },
    ]);
  });

  it("rejects a zero or negative quantity", () => {
    const { errors } = validateImportRows(
      [{ rowNumber: 2, cells: { Artikel: "Margherita", Menge: "0", Datum: "2026-08-01" } }],
      mapping,
      dishLookup,
    );
    expect(errors).toHaveLength(1);
  });

  it("rejects a quantity above the maximum", () => {
    const { errors } = validateImportRows(
      [
        {
          rowNumber: 2,
          cells: { Artikel: "Margherita", Menge: String(MAX_QUANTITY + 1), Datum: "2026-08-01" },
        },
      ],
      mapping,
      dishLookup,
    );
    expect(errors).toHaveLength(1);
  });

  it("rejects an unparseable date", () => {
    const { errors } = validateImportRows(
      [{ rowNumber: 4, cells: { Artikel: "Margherita", Menge: "1", Datum: "not-a-date" } }],
      mapping,
      dishLookup,
    );
    expect(errors).toEqual([
      { rowNumber: 4, message: expect.stringContaining("Ungültiges Datum") },
    ]);
  });

  it("rejects a future date", () => {
    const futureYear = new Date().getUTCFullYear() + 5;
    const { errors } = validateImportRows(
      [
        {
          rowNumber: 5,
          cells: { Artikel: "Margherita", Menge: "1", Datum: `${futureYear}-01-01` },
        },
      ],
      mapping,
      dishLookup,
    );
    expect(errors).toEqual([{ rowNumber: 5, message: expect.stringContaining("Zukunft") }]);
  });

  it("rejects a missing dish name", () => {
    const { errors } = validateImportRows(
      [{ rowNumber: 6, cells: { Artikel: "", Menge: "1", Datum: "2026-08-01" } }],
      mapping,
      dishLookup,
    );
    expect(errors).toEqual([{ rowNumber: 6, message: "Gericht fehlt." }]);
  });

  it("rejects a channel value longer than 100 characters", () => {
    const { errors } = validateImportRows(
      [
        {
          rowNumber: 7,
          cells: { Artikel: "Margherita", Menge: "1", Datum: "2026-08-01", Kanal: "x".repeat(101) },
        },
      ],
      mapping,
      dishLookup,
    );
    expect(errors).toEqual([{ rowNumber: 7, message: expect.stringContaining("Kanal/Quelle") }]);
  });

  it("processes every row and never stops at the first error -- all-or-nothing means every bad row must be reported, not just the first", () => {
    const { validRows, errors } = validateImportRows(
      [
        { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "1", Datum: "2026-08-01" } },
        { rowNumber: 2, cells: { Artikel: "Unbekannt", Menge: "1", Datum: "2026-08-01" } },
        { rowNumber: 3, cells: { Artikel: "Pasta Carbonara", Menge: "2", Datum: "2026-08-02" } },
        { rowNumber: 4, cells: { Artikel: "Margherita", Menge: "-1", Datum: "2026-08-01" } },
      ],
      mapping,
      dishLookup,
    );

    expect(validRows.map((r) => r.rowNumber)).toEqual([1, 3]);
    expect(errors.map((e) => e.rowNumber)).toEqual([2, 4]);
  });
});

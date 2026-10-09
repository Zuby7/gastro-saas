import { describe, expect, it } from "vitest";
import { formatPrice } from "./format";

const nbsp = " ";

describe("formatPrice", () => {
  it("formats EUR cents in German style", () => {
    expect(formatPrice(1250, "EUR")).toBe(`12,50${nbsp}€`);
    expect(formatPrice(0, "EUR")).toBe(`0,00${nbsp}€`);
    expect(formatPrice(5, "EUR")).toBe(`0,05${nbsp}€`);
  });

  it("uses German thousands separators", () => {
    expect(formatPrice(123456, "EUR")).toBe(`1.234,56${nbsp}€`);
  });

  it("rounds sub-cent fractions to two decimals", () => {
    expect(formatPrice(1999.4, "EUR")).toBe(`19,99${nbsp}€`);
    expect(formatPrice(1999.6, "EUR")).toBe(`20,00${nbsp}€`);
  });

  it("returns the fallback text for a null price", () => {
    expect(formatPrice(null, "EUR")).toBe("Preis nach Auswahl");
  });
});

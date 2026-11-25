import { describe, expect, it } from "vitest";
import { z } from "zod";
import { euroCentsField, formatCentsAsEuro, parseEuroToCents } from "./euro";

const cents = (input: string, options?: Parameters<typeof parseEuroToCents>[1]) => {
  const result = parseEuroToCents(input, options);
  return result.ok ? result.cents : result.reason;
};

describe("parseEuroToCents", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["12.50", 1250],
    ["12.5", 1250],
    ["0,99", 99],
    ["0", 0],
    ["1.250,00", 125000],
    ["1,250.00", 125000],
    ["1.250.000", "too_large"],
    [" 12,50 € ", 1250],
    ["€12,50", 1250],
    ["+3", 300],
    ["12,", "invalid"],
    [",5", "invalid"],
  ])("parses %j", (input, expected) => {
    expect(cents(input as string)).toBe(expected);
  });

  it("rejects empty and whitespace input", () => {
    expect(cents("")).toBe("empty");
    expect(cents("   ")).toBe("empty");
  });

  it("rejects negative amounts unless allowed", () => {
    expect(cents("-5")).toBe("negative");
    expect(cents("-5,50", { allowNegative: true })).toBe(-550);
    expect(cents("-0")).toBe(0);
  });

  it("rejects more than two decimals (including an ambiguous lone separator)", () => {
    expect(cents("12,505")).toBe("too_many_decimals");
    expect(cents("12.999")).toBe("too_many_decimals");
    expect(cents("1.250")).toBe("too_many_decimals");
    expect(cents("1,234")).toBe("too_many_decimals");
  });

  it("rejects non-numeric and malformed input", () => {
    expect(cents("abc")).toBe("invalid");
    expect(cents("1,2,3")).toBe("invalid");
    expect(cents("12 EUR")).toBe("invalid");
    expect(cents("1e3")).toBe("invalid");
  });

  it("enforces the upper bound", () => {
    expect(cents("100.000,00")).toBe(10_000_000);
    expect(cents("100.000,01")).toBe("too_large");
    expect(cents("99999999999")).toBe("too_large");
    expect(cents("50", { maxCents: 4999 })).toBe("too_large");
  });
});

describe("formatCentsAsEuro", () => {
  it("formats cents as a German euro string", () => {
    expect(formatCentsAsEuro(1250)).toBe("12,50");
    expect(formatCentsAsEuro(1200)).toBe("12,00");
    expect(formatCentsAsEuro(5)).toBe("0,05");
    expect(formatCentsAsEuro(0)).toBe("0,00");
    expect(formatCentsAsEuro(-550)).toBe("-5,50");
  });

  it("round-trips through parseEuroToCents", () => {
    for (const value of [0, 1, 99, 100, 1850, 123456]) {
      expect(cents(formatCentsAsEuro(value))).toBe(value);
    }
  });
});

describe("euroCentsField", () => {
  it("converts required fields and reports German messages", () => {
    const schema = z.object({ price: euroCentsField({ required: true }) });
    expect(schema.parse({ price: "12,50" })).toEqual({ price: 1250 });
    expect(schema.safeParse({ price: "" }).success).toBe(false);
    const decimals = schema.safeParse({ price: "1,234" });
    expect(decimals.success ? "" : decimals.error.issues[0]?.message).toContain("Nachkomma");
  });

  it("maps an empty optional field to null", () => {
    const schema = z.object({ price: euroCentsField({ required: false }) });
    expect(schema.parse({ price: "" })).toEqual({ price: null });
    expect(schema.parse({ price: undefined })).toEqual({ price: null });
    expect(schema.parse({ price: "9" })).toEqual({ price: 900 });
  });
});

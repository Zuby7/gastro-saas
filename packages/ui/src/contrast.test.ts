import { describe, expect, it } from "vitest";
import { contrastRatio, parseHexColor, validateContrastRatio } from "./contrast";

describe("parseHexColor", () => {
  it("parses 6-digit hex colors", () => {
    expect(parseHexColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses 3-digit shorthand hex colors", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("accepts hex colors without a leading #", () => {
    expect(parseHexColor("000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("throws on invalid input", () => {
    expect(() => parseHexColor("not-a-color")).toThrow();
    expect(() => parseHexColor("#12345")).toThrow();
  });
});

describe("contrastRatio", () => {
  it("returns 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("returns 1:1 for identical colors", () => {
    expect(contrastRatio("#3d8268", "#3d8268")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    const a = contrastRatio("#000000", "#ffffff");
    const b = contrastRatio("#ffffff", "#000000");
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("validateContrastRatio", () => {
  it("passes AA and AAA for black text on white background", () => {
    const result = validateContrastRatio("#000000", "#ffffff");
    expect(result.ratio).toBeCloseTo(21, 1);
    expect(result.passesAA).toBe(true);
    expect(result.passesAAA).toBe(true);
  });

  it("fails AA for low-contrast tenant branding colors (e.g. light grey on white)", () => {
    const result = validateContrastRatio("#dddddd", "#ffffff");
    expect(result.passesAA).toBe(false);
    expect(result.passesAAA).toBe(false);
  });

  it("applies the relaxed 3:1 AA threshold for large text", () => {
    // ratio is ~3.54:1 — fails normal-text AA (4.5) but passes large-text AA (3)
    const result = validateContrastRatio("#888888", "#ffffff", "large");
    expect(result.ratio).toBeGreaterThanOrEqual(3);
    expect(result.ratio).toBeLessThan(4.5);
    expect(result.passesAA).toBe(true);
  });

  it("fails normal-text AA for the same borderline ratio", () => {
    const result = validateContrastRatio("#888888", "#ffffff", "normal");
    expect(result.passesAA).toBe(false);
  });
});

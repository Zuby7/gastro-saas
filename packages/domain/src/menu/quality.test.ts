import { describe, expect, it } from "vitest";
import { evaluateMenuQuality, validateOptionGroupMinMax } from "./quality";

describe("menu quality", () => {
  it("rejects invalid min/max option groups", () => {
    expect(validateOptionGroupMinMax(2, 1)).toContain(
      "minSelections must not exceed maxSelections",
    );
  });

  it("blocks publishing a menu without a purchasable dish", () => {
    const issues = evaluateMenuQuality({
      dishes: [
        {
          id: "dish-1",
          name: "Soup",
          priceCents: null,
          hasPurchasableVariant: false,
          allergenReviewed: true,
        },
      ],
      optionGroups: [],
    });

    expect(issues.some((issue) => issue.severity === "blocker")).toBe(true);
  });

  it("warns when allergen review is missing but does not make it a blocker", () => {
    const issues = evaluateMenuQuality({
      dishes: [
        {
          id: "dish-1",
          name: "Soup",
          priceCents: 900,
          hasPurchasableVariant: false,
          allergenReviewed: false,
        },
      ],
      optionGroups: [],
    });

    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "allergen-review-missing" }),
    );
    expect(issues.some((issue) => issue.severity === "blocker")).toBe(false);
  });
});

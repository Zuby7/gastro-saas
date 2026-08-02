export interface MenuQualityDish {
  id: string;
  name: string;
  priceCents: number | null;
  hasPurchasableVariant: boolean;
  allergenReviewed: boolean;
}

export interface MenuQualityOptionGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  optionCount: number;
}

export interface MenuQualityInput {
  dishes: MenuQualityDish[];
  optionGroups: MenuQualityOptionGroup[];
}

export interface MenuQualityIssue {
  severity: "blocker" | "warning";
  code: string;
  message: string;
}

export function validateOptionGroupMinMax(minSelections: number, maxSelections: number): string[] {
  const errors: string[] = [];
  if (minSelections < 0) {
    errors.push("minSelections must be zero or greater");
  }
  if (maxSelections < 1) {
    errors.push("maxSelections must be at least one");
  }
  if (minSelections > maxSelections) {
    errors.push("minSelections must not exceed maxSelections");
  }
  return errors;
}

export function evaluateMenuQuality(input: MenuQualityInput): MenuQualityIssue[] {
  const issues: MenuQualityIssue[] = [];

  if (!input.dishes.some((dish) => dish.hasPurchasableVariant || dish.priceCents !== null)) {
    issues.push({
      severity: "blocker",
      code: "no-purchasable-dish",
      message: "At least one dish needs a price or purchasable variant.",
    });
  }

  for (const dish of input.dishes) {
    if (dish.priceCents === null && !dish.hasPurchasableVariant) {
      issues.push({
        severity: "blocker",
        code: "dish-without-price",
        message: `${dish.name} has no price or purchasable variant.`,
      });
    }
    if (!dish.allergenReviewed) {
      issues.push({
        severity: "warning",
        code: "allergen-review-missing",
        message: `${dish.name} has no restaurant-provided allergen review.`,
      });
    }
  }

  for (const group of input.optionGroups) {
    for (const error of validateOptionGroupMinMax(group.minSelections, group.maxSelections)) {
      issues.push({
        severity: "blocker",
        code: "invalid-option-min-max",
        message: `${group.name}: ${error}.`,
      });
    }
    if (group.optionCount === 0) {
      issues.push({
        severity: "blocker",
        code: "option-group-empty",
        message: `${group.name} has no options.`,
      });
    }
  }

  return issues;
}

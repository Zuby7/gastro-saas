import { describe, expect, it } from "vitest";
import { RatingSchema } from "./schemas";

describe("RatingSchema", () => {
  it("accepts a valid stars-only submission and defaults comment to an empty string", () => {
    const result = RatingSchema.safeParse({ stars: "5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ stars: 5, comment: "" });
    }
  });

  it("accepts a valid stars + comment submission", () => {
    const result = RatingSchema.safeParse({ stars: "3", comment: "  Sehr gut!  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stars).toBe(3);
      expect(result.data.comment).toBe("Sehr gut!");
    }
  });

  it.each([0, 6, -1, 2.5])("rejects an out-of-range/non-integer stars value (%s)", (stars) => {
    const result = RatingSchema.safeParse({ stars });
    expect(result.success).toBe(false);
  });

  it("rejects a missing stars value", () => {
    const result = RatingSchema.safeParse({ comment: "no stars given" });
    expect(result.success).toBe(false);
  });

  it("rejects a comment longer than 1000 characters", () => {
    const result = RatingSchema.safeParse({ stars: 4, comment: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { validateOpeningHour } from "./opening-hours";

describe("validateOpeningHour", () => {
  it("accepts closed days without times", () => {
    expect(validateOpeningHour({ weekday: 1, isClosed: true })).toEqual([]);
  });

  it("rejects end before start", () => {
    expect(
      validateOpeningHour({
        weekday: 1,
        isClosed: false,
        opensAt: "18:00",
        closesAt: "12:00",
      }),
    ).toContain("opensAt must be before closesAt");
  });
});

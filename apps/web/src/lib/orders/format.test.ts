import { describe, expect, it } from "vitest";
import { formatOrderTimestamp } from "./format";

describe("formatOrderTimestamp", () => {
  it("formats in German date + short time", () => {
    const out = formatOrderTimestamp("2026-10-09T12:34:00.000Z");
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });
});

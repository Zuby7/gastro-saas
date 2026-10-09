import { describe, expect, it } from "vitest";
import {
  CONSENT_VALIDITY_SECONDS,
  CONSENT_VERSION,
  hasStatisticsConsent,
  parseConsent,
  serializeConsent,
} from "./cookie";

describe("versioned consent storage", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");

  it("round-trips { version, timestamp, statistics }", () => {
    const raw = serializeConsent(true, now);
    expect(parseConsent(raw, now)).toEqual({
      status: "valid",
      record: { version: CONSENT_VERSION, timestamp: now.toISOString(), statistics: true },
    });
  });

  it("reports 'none' without a cookie", () => {
    expect(parseConsent(undefined, now)).toEqual({ status: "none" });
    expect(parseConsent("", now)).toEqual({ status: "none" });
  });

  it("treats legacy accepted/declined values as outdated (re-prompt, no statistics)", () => {
    for (const legacy of ["accepted", "declined"]) {
      expect(parseConsent(legacy, now)).toEqual({ status: "outdated" });
      expect(hasStatisticsConsent(legacy, now)).toBe(false);
    }
  });

  it("treats a different version as outdated", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        version: CONSENT_VERSION - 1,
        timestamp: now.toISOString(),
        statistics: true,
      }),
    );
    expect(parseConsent(raw, now)).toEqual({ status: "outdated" });
    expect(hasStatisticsConsent(raw, now)).toBe(false);
  });

  it("expires after 6 months but not just before", () => {
    const raw = serializeConsent(true, now);
    const justBefore = new Date(now.getTime() + (CONSENT_VALIDITY_SECONDS - 60) * 1000);
    const after = new Date(now.getTime() + (CONSENT_VALIDITY_SECONDS + 60) * 1000);
    expect(parseConsent(raw, justBefore).status).toBe("valid");
    expect(parseConsent(raw, after)).toEqual({ status: "outdated" });
    expect(CONSENT_VALIDITY_SECONDS).toBeGreaterThanOrEqual(60 * 60 * 24 * 180);
    expect(CONSENT_VALIDITY_SECONDS).toBeLessThanOrEqual(60 * 60 * 24 * 186);
  });

  it("rejects malformed or tampered payloads", () => {
    expect(parseConsent("%7Bnot-json", now)).toEqual({ status: "outdated" });
    expect(parseConsent(encodeURIComponent('{"version":2}'), now)).toEqual({ status: "outdated" });
    const future = new Date(now.getTime() + 86_400_000);
    expect(parseConsent(serializeConsent(true, future), now)).toEqual({ status: "outdated" });
  });

  it("statistics consent requires an explicit opt-in", () => {
    expect(hasStatisticsConsent(serializeConsent(false, now), now)).toBe(false);
    expect(hasStatisticsConsent(serializeConsent(true, now), now)).toBe(true);
    expect(hasStatisticsConsent(undefined, now)).toBe(false);
  });
});

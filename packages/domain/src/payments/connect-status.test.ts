import { describe, expect, it } from "vitest";
import { deriveConnectAccountStatus, summarizeConnectAccountRequirements } from "./connect-status";

describe("deriveConnectAccountStatus", () => {
  it("is enabled only when both charges and payouts are enabled", () => {
    expect(deriveConnectAccountStatus({ chargesEnabled: true, payoutsEnabled: true })).toBe(
      "enabled",
    );
  });

  it("is restricted when a disabled_reason is present", () => {
    expect(
      deriveConnectAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: false,
        disabledReason: "requirements.past_due",
      }),
    ).toBe("restricted");
  });

  it("is restricted when there are currently_due or past_due requirements", () => {
    expect(
      deriveConnectAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: false,
        currentlyDueCount: 2,
      }),
    ).toBe("restricted");
    expect(
      deriveConnectAccountStatus({
        chargesEnabled: true,
        payoutsEnabled: false,
        pastDueCount: 1,
      }),
    ).toBe("restricted");
  });

  it("is pending when nothing is enabled and nothing is outstanding yet", () => {
    expect(deriveConnectAccountStatus({ chargesEnabled: false, payoutsEnabled: false })).toBe(
      "pending",
    );
  });
});

describe("summarizeConnectAccountRequirements", () => {
  it("returns null when there is nothing outstanding", () => {
    expect(summarizeConnectAccountRequirements({})).toBeNull();
  });

  it("summarizes disabled reason and due counts", () => {
    expect(
      summarizeConnectAccountRequirements({
        disabledReason: "requirements.past_due",
        pastDueCount: 1,
        currentlyDueCount: 3,
      }),
    ).toBe("disabled_reason=requirements.past_due, 1 past_due, 3 currently_due");
  });
});

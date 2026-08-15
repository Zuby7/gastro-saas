import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { summarizeAccount } from "./connect";

function fakeAccount(overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: "acct_123",
    charges_enabled: false,
    payouts_enabled: false,
    requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    ...overrides,
  } as Stripe.Account;
}

describe("summarizeAccount", () => {
  it("maps a fully enabled Stripe account to status 'enabled'", () => {
    const snapshot = summarizeAccount(
      fakeAccount({ charges_enabled: true, payouts_enabled: true }),
    );
    expect(snapshot).toEqual({
      chargesEnabled: true,
      payoutsEnabled: true,
      status: "enabled",
      requirementsSummary: null,
    });
  });

  it("maps outstanding requirements to status 'restricted' with a summary", () => {
    const snapshot = summarizeAccount(
      fakeAccount({
        requirements: {
          disabled_reason: "requirements.past_due",
          currently_due: ["individual.dob.day"],
          past_due: ["individual.verification.document"],
        } as Stripe.Account.Requirements,
      }),
    );
    expect(snapshot.status).toBe("restricted");
    expect(snapshot.requirementsSummary).toContain("disabled_reason=requirements.past_due");
  });

  it("maps a fresh account with nothing outstanding to status 'pending'", () => {
    const snapshot = summarizeAccount(fakeAccount());
    expect(snapshot.status).toBe("pending");
    expect(snapshot.requirementsSummary).toBeNull();
  });
});

// Pure derivation logic for Stripe Connect Express onboarding status
// (ticket #23). Kept free of the Stripe SDK/network so it can be unit
// tested without mocking Stripe, and reused identically by the onboarding
// action, the return-redirect handler, and the account.updated webhook.

export type ConnectAccountStatus = "pending" | "restricted" | "enabled";

export interface ConnectAccountRequirements {
  /** Stripe's `requirements.disabled_reason`, if any. */
  disabledReason?: string | null;
  /** Count of `requirements.currently_due` entries. */
  currentlyDueCount?: number;
  /** Count of `requirements.past_due` entries. */
  pastDueCount?: number;
}

export interface DeriveConnectAccountStatusInput extends ConnectAccountRequirements {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/**
 * Derives the simple `pending`/`restricted`/`enabled` status this app
 * persists from Stripe's richer Account object. `enabled` requires both
 * charges and payouts to be enabled; `restricted` covers any outstanding
 * requirement (a disabled_reason or any currently/past-due item) that isn't
 * already blocking charges/payouts; everything else is still `pending`
 * (onboarding started, Stripe hasn't finished verifying yet).
 */
export function deriveConnectAccountStatus(
  input: DeriveConnectAccountStatusInput,
): ConnectAccountStatus {
  if (input.chargesEnabled && input.payoutsEnabled) {
    return "enabled";
  }

  const hasOutstandingRequirements =
    Boolean(input.disabledReason) ||
    (input.currentlyDueCount ?? 0) > 0 ||
    (input.pastDueCount ?? 0) > 0;

  if (hasOutstandingRequirements) {
    return "restricted";
  }

  return "pending";
}

/** Builds the short human-readable requirements summary persisted alongside `status`. */
export function summarizeConnectAccountRequirements(
  input: ConnectAccountRequirements,
): string | null {
  const parts: string[] = [];

  if (input.disabledReason) {
    parts.push(`disabled_reason=${input.disabledReason}`);
  }
  if ((input.pastDueCount ?? 0) > 0) {
    parts.push(`${input.pastDueCount} past_due`);
  }
  if ((input.currentlyDueCount ?? 0) > 0) {
    parts.push(`${input.currentlyDueCount} currently_due`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

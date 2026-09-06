import type Stripe from "stripe";
import {
  deriveConnectAccountStatus,
  summarizeConnectAccountRequirements,
  type ConnectAccountStatus,
} from "@gastro-saas/domain";

export interface ConnectAccountSnapshot {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: ConnectAccountStatus;
  requirementsSummary: string | null;
}

/**
 * Creates a Stripe Express connected account for a tenant (ticket #23,
 * ADR-0002). Country is fixed to Germany -- this app's current market -- and
 * capabilities are limited to the ones destination-charge checkout (ticket
 * #24) will need. No verification documents are ever handled by this
 * server: Stripe's hosted onboarding (Account Link, created separately)
 * collects them directly.
 *
 * `options.idempotencyKey` (issue #92): the caller passes a key derived from
 * the tenant's `payment_accounts` row (its primary key, `tenant_id`) so that
 * a retry after a failure elsewhere in the onboarding flow (e.g. the
 * subsequent DB write) reuses the exact same Stripe Express account instead
 * of creating a second, orphaned one.
 */
export async function createExpressAccount(
  stripe: Stripe,
  input: { tenantId: string; email?: string | null },
  options?: Stripe.RequestOptions,
): Promise<Stripe.Account> {
  return stripe.accounts.create(
    {
      type: "express",
      country: "DE",
      email: input.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { tenant_id: input.tenantId },
    },
    options,
  );
}

/**
 * Creates a fresh Stripe-hosted onboarding Account Link. Account Links
 * expire quickly and are single-use -- callers must always request a new
 * one rather than caching/reusing an old `url` (this is also how the
 * refresh_url flow is handled: generate a new link and redirect again).
 */
export async function createOnboardingAccountLink(
  stripe: Stripe,
  input: { accountId: string; returnUrl: string; refreshUrl: string },
): Promise<Stripe.AccountLink> {
  return stripe.accountLinks.create({
    account: input.accountId,
    type: "account_onboarding",
    return_url: input.returnUrl,
    refresh_url: input.refreshUrl,
  });
}

export async function retrieveAccount(stripe: Stripe, accountId: string): Promise<Stripe.Account> {
  return stripe.accounts.retrieve(accountId);
}

/** Reduces a Stripe Account object to the fields this app persists/displays. */
export function summarizeAccount(account: Stripe.Account): ConnectAccountSnapshot {
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const requirements = {
    disabledReason: account.requirements?.disabled_reason ?? null,
    currentlyDueCount: account.requirements?.currently_due?.length ?? 0,
    pastDueCount: account.requirements?.past_due?.length ?? 0,
  };

  return {
    chargesEnabled,
    payoutsEnabled,
    status: deriveConnectAccountStatus({ chargesEnabled, payoutsEnabled, ...requirements }),
    requirementsSummary: summarizeConnectAccountRequirements(requirements),
  };
}

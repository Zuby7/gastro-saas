# ADR-0002: Stripe Connect Account Type and Charge Type

- Status: Accepted
- Date: 2026-08-01

## Context

ADR-0001 chose Stripe Connect for payments but left the account topology (Standard/Express/Custom) and charge type (direct vs. destination charges) undecided. This choice determines who is the merchant of record, who bears chargeback/dispute liability, which Stripe account a webhook event arrives on (and therefore how it's mapped back to a tenant), and whether the platform can take an application fee. Getting this wrong after Epic 7 tickets (23–26) are built is a rewrite, not a tweak (flagged by the Opus architecture review, 2026-08-01).

## Decision

- **Account type**: Stripe **Express** accounts for tenants. Express gives tenants a fast, Stripe-hosted onboarding flow (fits the "no IT department" persona) while still letting the platform see charges/payouts status. Standard would hand the tenant a fully independent Stripe dashboard (more control than needed, harder to keep the platform's view of onboarding status in sync); Custom would require the platform to build its own onboarding UI, which is unnecessary MVP complexity.
- **Charge type**: **Destination charges** with `on_behalf_of` the connected account. The payment is created on the **platform's** Stripe account, then funds are transferred to the tenant's connected account. This means: webhooks for payment events arrive on the **platform account** (not per-tenant), and the tenant is resolved via the `transfer_data.destination` / connected account ID on the event — ticket 25 (webhook processing) must look up the tenant by connected account ID, not assume the platform account context implies a single tenant.
- **Fee model**: per `docs/platform/service-register.md`, Stripe bills the platform directly (no application fee taken in the MVP) — this can change later without altering the account/charge topology.
- **Liability**: with destination charges, the platform is the merchant of record for the charge; disputes are debited from the platform's Stripe balance first, then reversed from the connected account's available balance where possible. This is a real cash-flow exposure the user should be aware of before enabling production charges — not a decision to revisit silently later.

## Consequences

- Ticket 23 (Connect onboarding) implements Express onboarding, not Standard.
- Ticket 24 (checkout payment) creates the PaymentIntent on the platform account with `on_behalf_of` + `transfer_data`, not directly on the connected account.
- Ticket 25 (webhooks) must resolve tenant from the event's connected-account reference, and the webhook endpoint must be configured to receive **Connect** events (not just platform-account events).
- Dispute handling is a platform-level concern (residual risk, tracked in `docs/decisions/assumptions.md` — not built in the MVP).

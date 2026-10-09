# ADR-0003: PayPal via Stripe Connect without `on_behalf_of`

- Status: PROPOSED (not accepted; nothing is enabled)
- Date: 2026-10-09
- Related: ADR-0002 (Connect account model), issue #193

> This document is a technical and organizational analysis, not legal or tax advice. The merchant-of-record change described below must be reviewed by qualified legal and tax advisors before anything is enabled.

## Context

ADR-0002 chose destination charges with `on_behalf_of` for tenant payments. Testing in Stripe test mode (2026-10-09) showed that PayPal cannot be offered in that model. Stripe's API returns two separate errors:

1. PayPal + Connect (`transfer_data.destination`): `Your Stripe account currently does not support Connect payments with PayPal. To enable PayPal with Connect ... review the eligibility guidelines` (https://docs.stripe.com/payments/paypal#connect). The platform account is not (yet) eligible; Stripe has to enable it.
2. PayPal + `on_behalf_of`: `on_behalf_of cannot be used with the paypal payment method`.

PayPal alone on the platform account (no Connect) works. With Connect and dynamic payment methods, Stripe currently offers card, Bancontact, EPS, Klarna, Link, MB WAY, Amazon Pay and Satispay (Apple Pay/Google Pay via card). The checkout does not advertise PayPal (#191/#192).

## Options

- **A. Stripe enablement + drop `on_behalf_of` behind a feature flag (proposed).** Ask Stripe to enable PayPal with Connect for the platform. Behind the server-side flag `STRIPE_CONNECT_PAYPAL_ENABLED=1`, Checkout Sessions are created without `on_behalf_of` (keeping `transfer_data.destination`) and with dynamic payment methods, so PayPal appears once Stripe has enabled it. Default off keeps today's behavior unchanged. The code is implemented behind the flag; the flag is not enabled anywhere.
- **B. Direct PayPal Commerce Platform for Marketplaces integration.** A separate PayPal integration with its own onboarding, webhooks, refunds and reconciliation. Largest effort, a second payment provider in the payment state machine, separate compliance review.
- **C. No PayPal.** Keep card, Klarna and the other dynamic methods. No change, no new risk; some guests who prefer PayPal will not be served.

## Consequences (of A, to be confirmed)

Without `on_behalf_of` the platform account, not the connected account, is the settlement merchant of the charge. Points that need external review before acceptance:

- **Liability:** disputes/chargebacks for these payments. ADR-0002 already puts the platform first in line; this should be re-assessed for the changed settlement merchant.
- **VAT/tax:** who is treated as the seller/payment recipient for tax and invoicing purposes, and whether platform fees or reporting obligations change.
- **Statement descriptor:** the guest's card/PayPal statement shows the platform's descriptor instead of the restaurant's.
- **Refunds:** `refund-service.ts` already refunds on the platform account with `reverse_transfer: true`; this works for destination charges with or without `on_behalf_of` and is covered by a regression test. Payment-method-specific refund limits for PayPal should be checked in the sandbox.
- **Webhooks and state machine:** unchanged. Tenant identity is cross-checked via the `payments` row, the tenant's account, `event.account` (unset on platform events) and session metadata; none depend on `on_behalf_of`.
- **Cross-border/payout aspects:** `on_behalf_of` also influences settlement country and fees for connected accounts; confirm no regression for existing tenants (flag affects all new sessions, not per tenant).
- Required external review: legal and tax advice (merchant of record, VAT, terms for restaurants and guests) and Stripe's written confirmation of eligibility.

## Rollout steps (for A)

1. Accept this ADR after external review.
2. Stripe support request for PayPal with Connect on the platform account; record the answer.
3. Verify eligibility in the sandbox (and live account if Stripe requires it) with a PayPal + `transfer_data` session without `on_behalf_of`.
4. Flip `STRIPE_CONNECT_PAYPAL_ENABLED=1` in the test environment, then smoke test: PayPal payment, webhook to paid, refund.
5. Enable elsewhere only with explicit approval. Rollback: unset the flag.

The checklist is mirrored in `docs/operations/runbook-stripe-test-mode.md`.

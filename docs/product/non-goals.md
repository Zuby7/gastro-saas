# Non-Goals

Explicit non-goals prevent scope creep. Anything below may become a real goal later, but is deliberately excluded now.

## Not a consumer marketplace
gastro-saas does not build a Lieferando/Wolt/Uber-Eats-style multi-restaurant discovery marketplace. Each restaurant gets its own branded page, menu URL, and QR codes. A shared discovery surface may be considered in a future phase, not the MVP.

## No AI dependency for core functionality
The product must work without any AI API. Menu quality checks, publication blockers/warnings, low-performer detection, and recommendations are deterministic and rule-based in the MVP. Future AI features (PDF menu import, translation, description suggestions, review summarization) must sit behind a provider abstraction, be opt-in per tenant, and have a non-AI fallback — none of this is built now.

## No multi-location UI yet
The data model is location-ready (tenant → brand → location), but the onboarding and admin UI present exactly one location per tenant. Multi-location/restaurant-group UX is a later phase.

## No delivery fulfillment yet
Pickup and table ordering ship first. Delivery is a feature flag placeholder with no routing/logistics logic.

## No customer accounts
Guest checkout only. Optional customer accounts are a later phase.

## No real external integrations
Lieferando/Wolt/Uber Eats/POS/accounting/reservation integrations are designed for (provider-neutral interface + mock provider) but not connected. Only official, authorized partner APIs will ever be used — no scraping, no reverse engineering, no unofficial production connections, ever.

## No production infrastructure yet
No production Stripe activation, no purchased domain, no production deployment, no live customer data. All of this requires explicit human approval and is out of scope for the current engineering pass.

## No microservices
Modular monolith only. Service extraction is only justified by a documented, measured need — not speculative future scale.

## No large, unscoped ticket work
The system will not be built as one large, unreviewable change. Every change is one ticket, one focused pull request, reviewed by the Opus validator before merge.

# Product Vision

## Positioning

> The digital sales center for an independent restaurant: manage the menu, accept orders, get paid securely, and understand what customers actually buy.

> Enter information once and keep every digital sales channel up to date.

## Primary customer

A single independent gastronomy business (café, pizzeria, restaurant, snack bar, bakery with food service, takeaway) run by an owner-operator with a small team and no dedicated IT department. Time to configure the product is scarce; the product must be usable without technical knowledge.

## What the product does (see `mvp-scope.md` for what ships first)

1. Restaurant profile, opening hours, branding.
2. Visually appealing, mobile-first public menu with categories, variants, option groups, extras, removable ingredients, allergens, additives, dietary labels.
3. QR code generation for the restaurant, menu, tables, or takeaway counter.
4. Customer ordering with secure online payment (specialized payment provider, never a home-grown payment flow).
5. Admin order management: accept, prepare, mark ready, cancel, refund.
6. Sold-out controls at dish/variant/option granularity.
7. Understandable sales analytics: top sellers, low performers, trends, popular extras, commonly removed ingredients, conversion rates.
8. Verified customer ratings tied to completed orders.
9. Custom roles and fine-grained permissions per employee.
10. Strict tenant data isolation.
11. Rule-based menu quality/compliance checks before publication.
12. Integration-ready architecture for delivery marketplaces, POS, accounting, and reservation systems — without building a consumer marketplace itself.

## Growth path

The architecture supports future multi-location businesses and restaurant groups (tenant → brand → location), but the initial onboarding and UI present exactly one location per tenant. Complexity is introduced only when a ticket requires it — see `non-goals.md`.

## Why this exists

Independent restaurants are increasingly dependent on third-party marketplaces (commission fees, no customer relationship, no real sales insight) or have no digital ordering at all. gastro-saas gives them their own branded ordering channel, secure payments, and analytics they can actually understand — without needing an IT department to run it.

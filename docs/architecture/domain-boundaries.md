# Domain Boundaries

Modules, in the modular monolith. Each owns its own tables and exposes a typed interface; other modules call the interface, never the underlying tables directly.

| Module                 | Owns                                                                                                                                               | Depends on                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **identity**           | users, sessions, invitations                                                                                                                       | —                                 |
| **tenants**            | tenants, brands, locations, memberships                                                                                                            | identity                          |
| **authorization**      | roles, permissions, role_permissions                                                                                                               | identity, tenants                 |
| **restaurant-profile** | restaurant profile, opening hours, branding                                                                                                        | tenants                           |
| **menu**               | menus, categories, dishes, variants, option groups, options, allergens, additives, dietary labels, media, availability, publication/quality checks | tenants, restaurant-profile       |
| **ordering**           | carts, cart items, orders, order items, order state machine                                                                                        | menu, tenants                     |
| **payments**           | payment accounts, payments, refunds, webhook events                                                                                                | ordering, tenants                 |
| **analytics**          | analytics events, daily aggregates, metric definitions                                                                                             | ordering, payments, menu          |
| **reviews**            | ratings, moderation                                                                                                                                | ordering, tenants                 |
| **integrations**       | integration accounts, sync jobs, errors, mock provider                                                                                             | menu, ordering, tenants           |
| **notifications**      | email sends, templates                                                                                                                             | identity, ordering, payments      |
| **audit**              | audit log                                                                                                                                          | all (write-only append interface) |

## Rules

- No module reads or writes another module's tables directly. Cross-module reads go through a published query function; cross-module writes go through a published command function.
- `payments` is the only module allowed to hold Stripe secret keys; no other module or the browser ever sees them.
- `audit` is append-only from every module's perspective; nothing ever mutates or deletes an audit row from application code.
- New tables are introduced per-ticket as the domain model doc is implemented — not all upfront (§12 of the source brief: "do not automatically create every possible table before it is needed").

## Suggested code layout

```
apps/web            — Next.js app (routes, server actions, UI)
packages/domain      — domain modules (one folder per module above), pure TS + zod schemas
packages/database    — Supabase client, generated types, RLS policy source
packages/ui          — shared design-token-based components
packages/config      — shared eslint/tsconfig/tailwind config
packages/testing     — shared test utilities, fixtures, tenant test harness
```

If the multi-package overhead doesn't pay for itself early on, collapse `packages/domain` folders into `apps/web/src/modules/*` instead — record that change as a new ADR if it happens, don't silently drift.

## Integrations module (ticket #38)

The **integrations** module's provider-neutral interface and pure mock-provider logic live in `packages/domain/src/integrations/` (`provider.ts`'s `IntegrationProvider` interface, `mock-provider.ts`'s `createMockIntegrationProvider()`); the Supabase-touching wiring (reading the tenant's own published menu, invoking the provider, persisting the outcome) lives in `apps/web/src/lib/integrations/service.ts`, gated on the `integrations.manage` permission, with its admin UI at `apps/web/src/app/account/integrations/`. Only the mock provider exists today — no real Lieferando/Wolt/Uber-Eats/POS adapter (`.claude/rules/integrations.md`, this ticket's explicit non-goals). `integration_accounts`/`integration_sync_jobs`/`integration_errors` are tenant-scoped tables, each with RLS (`supabase/migrations/20260820090000_integration_accounts_sync_jobs_mock_provider.sql`).

# Documentation index

`docs/` is the single source of truth. When a decision changes, update the authoritative document below instead of creating a second one. Language: English (ticket files under `docs/tickets/` are German by instruction).

## Developer docs

| Document                                                                     | What it covers                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [development/getting-started.md](development/getting-started.md)             | Local setup, env var table, demo seed data, running unit/integration/e2e tests, coverage                 |
| [development/architecture-overview.md](development/architecture-overview.md) | Request flow, tenant isolation model, RLS/RPC pattern, Workers constraints, payments, cookies, analytics |
| [development/routes-and-modules.md](development/routes-and-modules.md)       | Every route with purpose/auth, and a map of `apps/web/src/lib` and `packages/*`                          |
| [development/contributing-workflow.md](development/contributing-workflow.md) | Ticket, branch, PR, CI, review and merge policy                                                          |

## Architecture and data

| Document                                                                                                       | What it covers                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [architecture/adr/0001-stack-and-modular-monolith.md](architecture/adr/0001-stack-and-modular-monolith.md)     | Stack choice (Next.js, Supabase, Stripe Connect, Cloudflare), modular monolith  |
| [architecture/adr/0002-stripe-connect-account-model.md](architecture/adr/0002-stripe-connect-account-model.md) | Express accounts, destination charges with `on_behalf_of`, liability            |
| [architecture/system-context.md](architecture/system-context.md)                                               | Actors and external systems                                                     |
| [architecture/domain-boundaries.md](architecture/domain-boundaries.md)                                         | Module ownership and dependency rules, package layout                           |
| [data/domain-model.md](data/domain-model.md)                                                                   | Tables and cross-cutting data rules (money in cents, immutability, soft delete) |

## Security, legal, testing

| Document                                                                     | What it covers                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [security/tenant-isolation.md](security/tenant-isolation.md)                 | The three isolation layers (guest paths, app authorization, RLS) and test requirement |
| [security/threat-model.md](security/threat-model.md)                         | Threats, mitigations, accepted risks                                                  |
| [legal/cookie-inventory.md](legal/cookie-inventory.md)                       | Cookie inventory, consent mechanism, maintenance rule (German, not legal advice)      |
| [legal/rechtsgrundlagen-uebersicht.md](legal/rechtsgrundlagen-uebersicht.md) | Overview of legal bases (German, not legal advice)                                    |
| [testing/test-strategy.md](testing/test-strategy.md)                         | Test pyramid, CI gate order, required status checks, coverage baseline and floor      |

## Operations

| Document                                                                         | What it covers                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [operations/deployment-strategy.md](operations/deployment-strategy.md)           | Environments, Cloudflare deployment history, migrations, backups, release checklist |
| [operations/runbook-stripe-test-mode.md](operations/runbook-stripe-test-mode.md) | Stripe test-mode setup end to end and how to verify it                              |
| [operations/troubleshooting.md](operations/troubleshooting.md)                   | Real problems we hit: symptom, cause, fix                                           |
| [operations/refund-reconciliation.md](operations/refund-reconciliation.md)       | Resolving stuck `unconfirmed`/`pending` refunds                                     |

## Product, platform, decisions, tickets

| Document                                                     | What it covers                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [product/product-vision.md](product/product-vision.md)       | Vision and target users                                                  |
| [product/mvp-scope.md](product/mvp-scope.md)                 | MVP scope                                                                |
| [product/non-goals.md](product/non-goals.md)                 | What is deliberately not built                                           |
| [platform/service-register.md](platform/service-register.md) | External services, free-tier limits, license policy                      |
| [decisions/assumptions.md](decisions/assumptions.md)         | Decisions made without asking, user-directed decisions, residual risks   |
| [tickets/README.md](tickets/README.md)                       | Local mirror of the GitHub Issues backlog (epics, milestones, numbering) |

Rules that apply to code live outside `docs/`: `CLAUDE.md` (invariants) and `.claude/rules/*.md` (auth, backend-api, database-migrations, deployment, frontend, integrations, payments, security, tenant-isolation, testing, analytics).

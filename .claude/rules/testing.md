---
description: Testing requirements — applies to every ticket
paths: ["**/*.test.ts", "**/*.spec.ts", "e2e/**", "packages/testing/**"]
---

Full strategy: `docs/testing/test-strategy.md`. Non-negotiables:

- Never disable, skip, or weaken a failing test to make CI green — fix the root cause or mark the ticket `BLOCKED` with a clear reason.
- Any change to a tenant-scoped table needs a cross-tenant test (two seeded tenants, prove no leak).
- Any change to payment logic needs webhook tests: success, failure, duplicate, out-of-order, invalid signature, amount mismatch, partial/full refund.
- Any change to a permission boundary needs a test for the *denied* case, not just the allowed one.
- Deterministic checks (format/lint/typecheck/tests/build) always run before requesting Opus validation — Opus never substitutes for them.

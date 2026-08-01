---
description: Backend/API rules — route handlers, server actions, domain modules
paths: ["apps/web/src/app/api/**", "packages/domain/**"]
---

- Validate every input (API body, query params, webhook payload) with a Zod schema at the boundary — no unvalidated data reaches domain logic.
- Every mutation and sensitive read resolves the acting user's tenant + permissions server-side before touching data — never trust a client-supplied `tenant_id`.
- Cross-module calls go through the target module's published interface, never its raw tables.
- Consistent error shape; never leak raw database errors or stack traces to the client.
- Paginate list endpoints; rate-limit auth and checkout endpoints; include a request correlation ID in logs.
- Idempotency keys for any endpoint that can be safely retried (payment creation, webhook handlers).

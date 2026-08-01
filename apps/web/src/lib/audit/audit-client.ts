import { Pool } from "pg";
import type { AuditQueryClient } from "@gastro-saas/domain";

// Lazily-created, process-wide pool: avoids opening a fresh Postgres
// connection per request. Direct `pg` access (not PostgREST) is used here
// because `recordAuditEvent()` (packages/domain/src/audit) is written
// against a generic parameterized-query interface, and this app currently
// only runs the Next.js Node.js runtime (`next dev`/`next start`), where a
// direct TCP connection works fine.
//
// Known follow-up, out of scope for this ticket: once this app is deployed
// to Cloudflare Workers (docs/platform/service-register.md), a raw `pg` TCP
// pool won't work the same way there -- that deployment will need a
// pooled/HTTP-based Postgres access strategy (e.g. Supavisor/Hyperdrive).
// Tracked as a deployment-readiness concern, not blocking here since no
// production deploy exists yet.
let pool: Pool | undefined;

function getAuditPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      throw new Error(
        "SUPABASE_DB_URL must be set to record audit events or resolve login-failure tenant context.",
      );
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** `AuditQueryClient` adapter for `recordAuditEvent()`, backed by a direct Postgres pool. */
export const auditQueryClient: AuditQueryClient = {
  query: (sql: string, params: readonly unknown[]) =>
    getAuditPool().query(sql, params as unknown[]),
};

/** Exposed for other server-side lookups that need the same pool (e.g. `login-audit.ts`). */
export function getAuditDbPool(): Pool {
  return getAuditPool();
}

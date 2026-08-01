// Small, shared helpers for locating and probing the local/CI Postgres
// instance that integration tests run against. Extracted from the ad-hoc
// pattern `packages/database/src/tenants.integration.test.ts` (ticket #4)
// wrote inline, so every future integration test suite (this package's own
// example test included) shares one implementation instead of copy-pasting
// the probe/skip dance.
import { Client } from "pg";

/** Default local Supabase Postgres connection string (`supabase start`). */
const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Resolves the Postgres connection string integration tests should use:
 * `SUPABASE_DB_URL` if set (CI, or a developer pointing at a non-default
 * instance), otherwise the standard local `supabase start` connection string.
 */
export function getTestDatabaseUrl(): string {
  return process.env.SUPABASE_DB_URL ?? DEFAULT_LOCAL_DB_URL;
}

/**
 * True when this process is expected to have a real Postgres instance
 * available and should therefore treat a missing database as a hard failure
 * rather than something to quietly skip: CI, or `SUPABASE_DB_URL` explicitly
 * set by a developer who intends to run against a real database.
 */
export function isDatabaseRequired(): boolean {
  return Boolean(process.env.CI) || Boolean(process.env.SUPABASE_DB_URL);
}

/** Probes whether `url` (defaults to {@link getTestDatabaseUrl}) is reachable. */
export async function probeTestDatabase(url: string = getTestDatabaseUrl()): Promise<boolean> {
  const probe = new Client({ connectionString: url });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

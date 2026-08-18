#!/usr/bin/env node
// ============================================================================
// Epic 8 Opus batch review, finding 8: supabase/seed.sql now refuses to run
// unless the `gastro_saas.allow_demo_seed` Postgres session setting is
// explicitly 'on' (see that file's own guard comment for the full
// rationale -- it protects against accidentally running the raw seed file,
// which creates real auth.users rows with a shared, publicly-documented
// password, against anything other than a local/throwaway database).
//
// `supabase db reset`/`supabase start` invoke the seed step via their own
// internal Postgres client, which does not honor `PGOPTIONS` the way a
// plain `psql` invocation would -- so the opt-in can't be set from the
// *outside* of that step. This script is the local-only companion that:
//   1. Connects directly to the local database (SUPABASE_DB_URL, defaulting
//      to the same local connection string every other local-only script/
//      test in this repo uses).
//   2. Sets gastro_saas.allow_demo_seed = 'on' for that one session only
//      (never persisted to the database itself -- a fresh connection
//      without this script would still be refused).
//   3. Runs supabase/seed.sql's contents in that same session.
//
// `db:reset`/`db:start` (see package.json) now run `supabase db reset
// --no-seed`/`supabase start --no-seed` followed by this script, instead of
// supabase CLI's own built-in auto-seed step -- see docs/decisions/
// assumptions.md for the documented opt-in and why it's structured this way.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "seed.sql",
);
const seedSql = readFileSync(seedPath, "utf8");

const client = new pg.Client({ connectionString: DB_URL });

try {
  await client.connect();
  // Session-level only (no `local` keyword persistence beyond this
  // connection, and never written to the database itself) -- a separate
  // connection running supabase/seed.sql directly (e.g. a bare `psql -f`)
  // still gets refused by that file's own guard.
  await client.query("set gastro_saas.allow_demo_seed = 'on'");
  await client.query(seedSql);
  // eslint-disable-next-line no-console
  console.log("[run-local-seed] supabase/seed.sql applied (gastro_saas.allow_demo_seed=on).");
} finally {
  await client.end();
}

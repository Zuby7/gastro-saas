// Integration test for the atomic auth-rate-limit RPCs added in ticket #7
// fix cycle 1 (Opus review, artifacts/reviews/issue-7.json item 3):
// `reserve_auth_rate_limit_attempt` / `mark_auth_rate_limit_attempt_succeeded`
// (see supabase/migrations/20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql).
//
// Proves what the previous check-then-act design (separate SELECT count,
// then separate INSERT) could not guarantee: firing many concurrent
// attempts for the same (scope, ip, email) never lets more than the
// configured max slip through as "not yet limited", because the reserve +
// count happen in one atomic, advisory-lock-serialized round-trip. Also
// proves the "only failures count" and "keyed by (ip, email), not email
// alone" fixes (items 2/6) directly against the real functions.
//
// Same DB-probe/skip pattern as the other integration suites in this
// package: requires a real local Supabase stack (`supabase start`); skips
// locally with a warning if unreachable, throws in CI instead of silently
// skipping.
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isCiEnvironment = Boolean(process.env.CI) || Boolean(process.env.SUPABASE_DB_URL);

async function probeDatabase(): Promise<boolean> {
  const probe = new Client({ connectionString: DB_URL });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await probeDatabase();

if (!dbAvailable) {
  if (isCiEnvironment) {
    throw new Error(
      `[auth-rate-limit.integration.test] CI or SUPABASE_DB_URL is set, but no reachable Postgres ` +
        `was found at ${DB_URL}. Refusing to silently skip the atomic rate-limit suite in CI -- ` +
        "check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[auth-rate-limit.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working local Docker setup) " +
      "to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

interface ReserveRow {
  attempt_id: string;
  ip_count: number;
  ip_email_count: number;
}

describe.skipIf(!dbAvailable)(
  "reserve_auth_rate_limit_attempt / mark_auth_rate_limit_attempt_succeeded (ticket #7 fix cycle 1)",
  () => {
    let pool: Pool;
    const scope = "login";
    const createdEmails: string[] = [];

    beforeAll(() => {
      pool = new Pool({ connectionString: DB_URL, max: 20 });
    });

    afterEach(async () => {
      if (createdEmails.length > 0) {
        await pool.query(
          `delete from auth_rate_limit_attempts where scope = $1 and email = any($2::text[])`,
          [scope, createdEmails],
        );
        createdEmails.length = 0;
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    async function reserve(ip: string, email: string, windowSeconds = 900): Promise<ReserveRow> {
      const result = await pool.query<ReserveRow>(
        `select attempt_id, ip_count, ip_email_count from reserve_auth_rate_limit_attempt($1, $2, $3, $4)`,
        [scope, ip, email, windowSeconds],
      );
      return result.rows[0]!;
    }

    it("allows at most maxAttempts concurrent callers to observe themselves as under the limit", async () => {
      const ip = `10.77.0.${Math.floor(Math.random() * 200) + 1}`;
      const email = `concurrent-${randomUUID()}@example.test`;
      createdEmails.push(email);
      const maxAttempts = 5;
      const concurrency = 15;

      const rows = await Promise.all(Array.from({ length: concurrency }, () => reserve(ip, email)));

      const underLimitCount = rows.filter((row) => row.ip_email_count <= maxAttempts).length;
      expect(underLimitCount).toBe(maxAttempts);

      // Every concurrent caller's attempt was still durably recorded --
      // atomicity here means "counts are accurate", not "attempts over the
      // limit are dropped" (the app layer decides what to do once it sees
      // `limited: true`).
      const total = await pool.query(
        `select count(*)::int as c from auth_rate_limit_attempts where scope = $1 and ip = $2 and email = $3`,
        [scope, ip, email],
      );
      expect(total.rows[0]?.c).toBe(concurrency);
    });

    it("excludes an attempt marked succeeded from future failure counts", async () => {
      const ip = "10.77.1.1";
      const email = `succeeded-${randomUUID()}@example.test`;
      createdEmails.push(email);

      const first = await reserve(ip, email);
      await pool.query(`select mark_auth_rate_limit_attempt_succeeded($1)`, [first.attempt_id]);

      const second = await reserve(ip, email);
      expect(second.ip_email_count).toBe(1);
    });

    it("keys by (ip, email), not email alone -- a fresh IP is never blocked by another IP's failures against the same email", async () => {
      const email = `victim-${randomUUID()}@example.test`;
      createdEmails.push(email);

      for (let i = 0; i < 20; i += 1) {
        await reserve(`10.77.2.${i}`, email);
      }

      const freshIp = await reserve("10.77.2.250", email);
      expect(freshIp.ip_email_count).toBe(1);
    });
  },
);

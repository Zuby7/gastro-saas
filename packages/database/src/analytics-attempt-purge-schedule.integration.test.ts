// Issue #164: the retention purge functions must stay service_role-only and,
// where pg_cron exists, be scheduled by migration 20260906170000.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

if (!dbAvailable && isCiEnvironment) {
  throw new Error("Database unavailable in CI: purge schedule integration test cannot run.");
}

const FUNCTIONS = [
  "public.purge_stale_menu_view_attempts(integer)",
  "public.purge_stale_dish_engagement_attempts(integer)",
];

describe.skipIf(!dbAvailable)("analytics attempt purge schedule (#164)", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it.each(FUNCTIONS)(
    "%s is not executable by anon/authenticated, only service_role",
    async (fn) => {
      const { rows } = await client.query<{ role: string; ok: boolean }>(
        `select r as role, has_function_privilege(r, $1, 'execute') as ok
         from unnest(array['anon','authenticated','service_role']) r`,
        [fn],
      );
      const byRole = Object.fromEntries(rows.map((r) => [r.role, r.ok]));
      expect(byRole).toEqual({ anon: false, authenticated: false, service_role: true });
    },
  );

  it("schedules both daily jobs when pg_cron is available (no-op otherwise)", async () => {
    const ext = await client.query("select 1 from pg_extension where extname = 'pg_cron'");
    if (ext.rowCount === 0) {
      return; // migration is a documented no-op without pg_cron
    }
    const { rows } = await client.query<{ jobname: string; command: string }>(
      `select jobname, command from cron.job
        where jobname in ('purge-menu-view-attempts','purge-dish-engagement-attempts')
        order by jobname`,
    );
    expect(rows.map((r) => r.jobname)).toEqual([
      "purge-dish-engagement-attempts",
      "purge-menu-view-attempts",
    ]);
    expect(rows.every((r) => r.command.includes("purge_stale_"))).toBe(true);
  });
});

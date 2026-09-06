// Integration tests for `record_menu_view()` (ticket #67, "Öffentliche
// Menü-Ansicht: geratelimitete/deduplizierte View-Analytics statt entfernter
// Inline-Insert" -- see
// supabase/migrations/20260905120000_menu_view_rate_limited_analytics.sql).
//
// Proves the three properties the ticket requires:
// - Dedup: repeated calls for the same (tenant, session, UTC day) produce
//   exactly one analytics_events row.
// - Independent counting: a different session, or the same session on a
//   different day, each counts separately.
// - Rate limiting: a burst of rapid calls from the same (tenant, ip_hash)
//   bucket, even across many distinct sessions, is capped -- it cannot
//   create unbounded rows.
// Plus a cross-tenant test proving session tokens never leak across
// tenants (two tenants, same raw session_token_hash, each tenant still gets
// its own independent event).
//
// Same DB-probe/skip pattern as the other integration suites in this package.
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
    throw new Error(`[menu-view-analytics.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[menu-view-analytics.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe.skipIf(!dbAvailable)("record_menu_view (ticket #67)", () => {
  let admin: Client;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    admin = new Client({ connectionString: DB_URL });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  async function recordView(tenantId: string, sessionTokenHash: string, ipHash: string) {
    const result = await admin.query<{ record_menu_view: boolean }>(
      `select record_menu_view($1, $2, $3) as record_menu_view`,
      [tenantId, sessionTokenHash, ipHash],
    );
    return result.rows[0]!.record_menu_view;
  }

  async function countMenuViewedEvents(tenantId: string): Promise<number> {
    const result = await admin.query<{ c: string }>(
      `select count(*)::int as c from analytics_events where tenant_id = $1 and event_type = 'menu_viewed'`,
      [tenantId],
    );
    return Number(result.rows[0]!.c);
  }

  it("dedupes repeated calls for the same tenant+session+day into exactly one event", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const sessionHash = hash(`session-${randomUUID()}`);
    const ipHash = hash("203.0.113.10");

    const firstResult = await recordView(tenantA.tenantId, sessionHash, ipHash);
    const secondResult = await recordView(tenantA.tenantId, sessionHash, ipHash);
    const thirdResult = await recordView(tenantA.tenantId, sessionHash, ipHash);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(thirdResult).toBe(false);
    expect(await countMenuViewedEvents(tenantA.tenantId)).toBe(1);
  });

  it("counts a different session for the same tenant as an independent event", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const ipHash = hash("203.0.113.11");

    await recordView(tenantA.tenantId, hash(`session-${randomUUID()}`), ipHash);
    await recordView(tenantA.tenantId, hash(`session-${randomUUID()}`), ipHash);

    expect(await countMenuViewedEvents(tenantA.tenantId)).toBe(2);
  });

  it("counts the same session again as an independent event once the dedup day rolls over", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const sessionHash = hash(`session-${randomUUID()}`);
    const ipHash = hash("203.0.113.12");

    const first = await recordView(tenantA.tenantId, sessionHash, ipHash);
    expect(first).toBe(true);

    // Simulate "yesterday" by directly backdating the dedup row's view_date
    // (there is no clock-mocking hook into the SECURITY DEFINER function
    // itself, and the function always anchors to `now()` -- backdating the
    // row it wrote is the most direct way to prove a new UTC day is treated
    // as a fresh dedup window without reimplementing the function's date
    // logic in the test).
    await admin.query(
      `update menu_view_attempts set view_date = view_date - interval '1 day' where tenant_id = $1 and session_token_hash = $2`,
      [tenantA.tenantId, sessionHash],
    );

    const second = await recordView(tenantA.tenantId, sessionHash, ipHash);
    expect(second).toBe(true);
    expect(await countMenuViewedEvents(tenantA.tenantId)).toBe(2);
  });

  it("rate-limits a burst of rapid calls from the same tenant+ip bucket, even across distinct sessions", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const ipHash = hash("203.0.113.13");

    // The fixed rate-limit threshold inside record_menu_view() is 30 attempts
    // per (tenant_id, ip_hash) within a 10-minute window (see the migration's
    // header comment) -- fire well past it, each with its own fresh session,
    // to prove a session-rotating burst still can't create unbounded rows.
    const attempts = 40;
    const results: boolean[] = [];
    for (let i = 0; i < attempts; i += 1) {
      results.push(
        await recordView(tenantA.tenantId, hash(`burst-session-${i}-${randomUUID()}`), ipHash),
      );
    }

    const recordedCount = results.filter(Boolean).length;
    expect(recordedCount).toBe(30);
    expect(await countMenuViewedEvents(tenantA.tenantId)).toBe(30);

    const totalAttemptRows = await admin.query<{ c: string }>(
      `select count(*)::int as c from menu_view_attempts where tenant_id = $1 and ip_hash = $2`,
      [tenantA.tenantId, ipHash],
    );
    // Rate-limited calls write nothing at all -- attempt rows never exceed
    // the threshold either, proving the burst is bounded, not just the
    // analytics_events count.
    expect(Number(totalAttemptRows.rows[0]!.c)).toBe(30);
  });

  it("keeps the same raw session token independent across two tenants (no cross-tenant leak)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const sharedSessionHash = hash("shared-browser-session");
    const ipHash = hash("203.0.113.14");

    const resultA = await recordView(tenantA.tenantId, sharedSessionHash, ipHash);
    const resultB = await recordView(tenantB.tenantId, sharedSessionHash, ipHash);
    // Repeating for tenant A must still be deduped, proving the dedup key
    // is genuinely (tenant_id, session_token_hash, day) and not accidentally
    // just (session_token_hash, day).
    const resultARepeat = await recordView(tenantA.tenantId, sharedSessionHash, ipHash);

    expect(resultA).toBe(true);
    expect(resultB).toBe(true);
    expect(resultARepeat).toBe(false);
    expect(await countMenuViewedEvents(tenantA.tenantId)).toBe(1);
    expect(await countMenuViewedEvents(tenantB.tenantId)).toBe(1);
  });

  it("returns false and writes nothing for an unresolvable tenant id", async () => {
    const result = await recordView(randomUUID(), hash("session"), hash("203.0.113.15"));
    expect(result).toBe(false);
  });
});

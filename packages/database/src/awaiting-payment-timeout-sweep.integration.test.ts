// Integration tests for `sweep_stale_awaiting_payment_orders()` (issue #88):
// an order left in `awaiting_payment` past a configurable timeout (default 30
// minutes, .claude/rules/payments.md rule 14) must be cancelled automatically
// via the existing order_status_events write path, and a fresh
// `awaiting_payment` order must be left completely untouched. Same
// DB-probe/skip pattern as the other database integration suites.
import { randomUUID } from "node:crypto";
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
    throw new Error(
      `[awaiting-payment-timeout-sweep.integration.test] CI or SUPABASE_DB_URL is set, but no ` +
        `reachable Postgres was found at ${DB_URL}. Refusing to silently skip the issue #88 sweep ` +
        "suite in CI -- check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[awaiting-payment-timeout-sweep.integration.test] Skipping: no reachable Postgres at ` +
      `${DB_URL}. Run \`pnpm --filter @gastro-saas/database db:start\` (requires a working local ` +
      "Docker setup) to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

/**
 * Seeds an order in `awaiting_payment` (with the same initial
 * order_status_events row create_order_from_cart() itself would have
 * written), backdating `created_at` on both the order and its initial event
 * so age-based sweep logic has something real to compare against.
 */
async function seedAwaitingPaymentOrder(
  admin: Client,
  tenantId: string,
  ageMinutes: number,
): Promise<string> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, created_at)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', 1999, now() - ($4::text || ' minutes')::interval)`,
    [orderId, tenantId, tokenHash, ageMinutes],
  );

  await admin.query(
    `insert into order_status_events (tenant_id, order_id, from_status, to_status, created_at)
     values ($1, $2, null, 'awaiting_payment', now() - ($3::text || ' minutes')::interval)`,
    [tenantId, orderId, ageMinutes],
  );

  return orderId;
}

async function getOrderStatus(admin: Client, orderId: string): Promise<string> {
  const result = await admin.query<{ status: string }>(`select status from orders where id = $1`, [
    orderId,
  ]);
  return result.rows[0]!.status;
}

describe.skipIf(!dbAvailable)(
  "sweep_stale_awaiting_payment_orders() (issue #88, risk:payment)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterEach(async () => {
      if (fixture) {
        await admin.query(`delete from order_status_events where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
        await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
      }
      await fixture?.cleanup();
    });

    afterAll(async () => {
      await admin.end();
    });

    it("cancels an old awaiting_payment order past the default 30-minute timeout, and leaves a fresh one untouched", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const staleOrderId = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 40);
      const freshOrderId = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 2);

      const result = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders()`,
      );
      expect(result.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(1);

      expect(await getOrderStatus(admin, staleOrderId)).toBe("cancelled");
      expect(await getOrderStatus(admin, freshOrderId)).toBe("awaiting_payment");

      const staleEvents = await admin.query<{
        from_status: string | null;
        to_status: string;
        actor_user_id: string | null;
        note: string | null;
      }>(
        `select from_status, to_status, actor_user_id, note from order_status_events
          where order_id = $1 order by created_at`,
        [staleOrderId],
      );
      expect(staleEvents.rows.map((r) => r.to_status)).toEqual(["awaiting_payment", "cancelled"]);
      const cancelEvent = staleEvents.rows[1]!;
      expect(cancelEvent.from_status).toBe("awaiting_payment");
      expect(cancelEvent.actor_user_id).toBeNull();
      expect(cancelEvent.note).toMatch(/Automatisch storniert/);

      // The fresh order must have no cancellation event at all -- untouched.
      const freshEvents = await admin.query<{ to_status: string }>(
        `select to_status from order_status_events where order_id = $1 order by created_at`,
        [freshOrderId],
      );
      expect(freshEvents.rows.map((r) => r.to_status)).toEqual(["awaiting_payment"]);
    });

    it("sweeps stale orders across multiple tenants in one pass, attributing each cancellation to its own tenant_id (cross-tenant correctness)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const staleOrderIdA = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 45);
      const staleOrderIdB = await seedAwaitingPaymentOrder(admin, fixture.tenantB.tenantId, 45);
      const freshOrderIdB = await seedAwaitingPaymentOrder(admin, fixture.tenantB.tenantId, 1);

      const result = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders()`,
      );
      expect(result.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(2);

      expect(await getOrderStatus(admin, staleOrderIdA)).toBe("cancelled");
      expect(await getOrderStatus(admin, staleOrderIdB)).toBe("cancelled");
      expect(await getOrderStatus(admin, freshOrderIdB)).toBe("awaiting_payment");

      // Each cancellation event's tenant_id must match its own order's
      // tenant, never the other tenant's.
      const eventTenantB = await admin.query<{ tenant_id: string }>(
        `select tenant_id from order_status_events where order_id = $1 and to_status = 'cancelled'`,
        [staleOrderIdB],
      );
      expect(eventTenantB.rows[0]!.tenant_id).toBe(fixture.tenantB.tenantId);
    });

    it("is idempotent: a second sweep call is a no-op once the stale order was already cancelled", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const staleOrderId = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 60);

      const first = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders()`,
      );
      expect(first.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(1);

      const second = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders()`,
      );
      expect(second.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(0);

      const events = await admin.query<{ to_status: string }>(
        `select to_status from order_status_events where order_id = $1 order by created_at`,
        [staleOrderId],
      );
      // Still exactly one cancellation event, not duplicated.
      expect(events.rows.map((r) => r.to_status)).toEqual(["awaiting_payment", "cancelled"]);
    });

    it("honors a configurable timeout override tighter than the default 30 minutes", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const orderId = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 10);

      // Default timeout (30 min): 10-minute-old order is untouched.
      const defaultRun = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders()`,
      );
      expect(defaultRun.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(0);
      expect(await getOrderStatus(admin, orderId)).toBe("awaiting_payment");

      // Tighter override (5 min): now the same order is stale.
      const overrideRun = await admin.query<{ sweep_stale_awaiting_payment_orders: number }>(
        `select sweep_stale_awaiting_payment_orders(5)`,
      );
      expect(overrideRun.rows[0]!.sweep_stale_awaiting_payment_orders).toBe(1);
      expect(await getOrderStatus(admin, orderId)).toBe("cancelled");
    });

    it("rejects a non-positive timeout instead of silently cancelling everything", async () => {
      fixture = await seedTwoTenantFixture(admin);
      await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId, 60);

      await expect(admin.query(`select sweep_stale_awaiting_payment_orders(0)`)).rejects.toThrow(
        /p_timeout_minutes must be a positive integer/,
      );
    });

    it("is only callable by service_role, never by an authenticated session directly", async () => {
      const result = await admin.query<{ has_priv: boolean }>(
        `select has_function_privilege('authenticated', 'sweep_stale_awaiting_payment_orders(integer)', 'execute') as has_priv`,
      );
      expect(result.rows[0]!.has_priv).toBe(false);
    });
  },
);

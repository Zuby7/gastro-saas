// Integration tests for `get_analytics_dashboard_summary()` (ticket #30,
// Epic 9 "Analytics-Grunddashboard"). Same DB-probe/skip pattern as the
// other database integration suites.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { queryAsUser, seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
    throw new Error(`[analytics-dashboard.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[analytics-dashboard.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

interface SeedOrderOptions {
  tenantId: string;
  totalCents: number;
  status?: string;
}

interface SeedPaymentOptions {
  tenantId: string;
  orderId: string;
  amountCents: number;
  status: "pending" | "paid" | "failed" | "cancelled" | "flagged_for_review";
  createdAt: Date;
}

/** Seeds an order, bypassing checkout (out of this ticket's scope). */
async function seedOrder(admin: Client, options: SeedOrderOptions): Promise<string> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', $4)`,
    [orderId, options.tenantId, tokenHash, options.totalCents],
  );

  await admin.query(
    `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, null, 'awaiting_payment')`,
    [options.tenantId, orderId],
  );

  // Walk the real state machine (awaiting_payment -> received -> accepted ->
  // preparing -> ready -> completed) so this seed helper never inserts an
  // out-of-order transition the DB's own validate_order_status_event() would
  // reject.
  const path = ["received", "accepted", "preparing", "ready", "completed"] as const;
  const targetIndex = options.status ? path.indexOf(options.status as (typeof path)[number]) : -1;

  if (options.status === "cancelled") {
    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'cancelled')`,
      [options.tenantId, orderId],
    );
  } else if (targetIndex >= 0) {
    let fromStatus = "awaiting_payment";
    for (let i = 0; i <= targetIndex; i += 1) {
      const toStatus = path[i]!;
      await admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, $3, $4)`,
        [options.tenantId, orderId, fromStatus, toStatus],
      );
      fromStatus = toStatus;
    }
  }

  return orderId;
}

async function ensurePaymentAccount(admin: Client, tenantId: string): Promise<string> {
  const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await admin.query(
    `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
     values ($1, $2, 'enabled', true, true)
     on conflict (tenant_id) do update set stripe_account_id = excluded.stripe_account_id, charges_enabled = true`,
    [tenantId, stripeAccountId],
  );
  return stripeAccountId;
}

/** Seeds a payments row with an explicit created_at (bypassing the webhook flow, out of this ticket's scope). */
async function seedPayment(
  admin: Client,
  stripeAccountId: string,
  options: SeedPaymentOptions,
): Promise<string> {
  const paymentId = randomUUID();
  await admin.query(
    `insert into payments (id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'EUR', $8, $9)`,
    [
      paymentId,
      options.tenantId,
      options.orderId,
      `cs_test_${randomUUID().replace(/-/g, "")}`,
      `pi_test_${randomUUID().replace(/-/g, "")}`,
      stripeAccountId,
      options.amountCents,
      options.status,
      options.createdAt.toISOString(),
    ],
  );
  return paymentId;
}

describe.skipIf(!dbAvailable)("get_analytics_dashboard_summary() (ticket #30)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      await admin.query(`delete from refunds where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from payments where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from order_status_events where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from payment_accounts where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from restaurant_profiles where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
    }
    await fixture?.cleanup();
  });

  afterAll(async () => {
    await admin.end();
  });

  async function seedFixtureWithManager(): Promise<{
    fixture: TwoTenantFixture;
    managerId: string;
    staffId: string;
  }> {
    const managerId = randomUUID();
    const staffId = randomUUID();
    const seeded = await seedTwoTenantFixture(admin, {
      tenantA: { additionalMembers: [{ userId: managerId, role: "manager" }] },
      tenantB: { additionalMembers: [{ userId: staffId, role: "staff" }] },
    });
    return { fixture: seeded, managerId, staffId };
  }

  async function getSummary(actorUserId: string, tenantId: string, asOf: Date) {
    const result = await queryAsUser(
      admin,
      actorUserId,
      `select get_analytics_dashboard_summary($1, $2) as summary`,
      [tenantId, asOf.toISOString()],
    );
    return result.rows[0]!.summary as Record<string, unknown>;
  }

  it("a paid order today influences the metrics correctly", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const asOf = new Date("2026-08-18T12:00:00Z");
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 2500,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 2500,
      status: "paid",
      createdAt: new Date("2026-08-18T10:00:00Z"),
    });

    const summary = await getSummary(seed.managerId, fixture.tenantA.tenantId, asOf);

    expect(summary.grossRevenueTodayCents).toBe(2500);
    expect(summary.netRevenueTodayCents).toBe(2500);
    expect(summary.paidOrdersTodayCount).toBe(1);
    expect(summary.avgOrderValueCents).toBe(2500);
  });

  it("a refund reduces net revenue correctly without affecting gross revenue or the paid order count", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const asOf = new Date("2026-08-18T12:00:00Z");
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 4000,
    });
    const paymentId = await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 4000,
      status: "paid",
      createdAt: new Date("2026-08-18T09:00:00Z"),
    });

    await admin.query(
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
       values ($1, $2, $3, 1500, 'EUR', 'Teilrückerstattung', $4, 'succeeded')`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );

    const summary = await getSummary(seed.managerId, fixture.tenantA.tenantId, asOf);

    expect(summary.grossRevenueTodayCents).toBe(4000);
    expect(summary.refundsTodayCents).toBe(1500);
    expect(summary.netRevenueTodayCents).toBe(2500);
    expect(summary.paidOrdersTodayCount).toBe(1);
  });

  it("only counts succeeded refunds, not pending/unconfirmed reservations, against net revenue", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const asOf = new Date("2026-08-18T12:00:00Z");
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1000,
    });
    const paymentId = await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 1000,
      status: "paid",
      createdAt: new Date("2026-08-18T09:00:00Z"),
    });

    await admin.query(
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
       values ($1, $2, $3, 500, 'EUR', 'noch nicht bestätigt', $4, 'pending')`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );

    const summary = await getSummary(seed.managerId, fixture.tenantA.tenantId, asOf);

    expect(summary.netRevenueTodayCents).toBe(1000);
  });

  it("shows an honest empty state (null average, zero counts) instead of a fabricated average when there is no data", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;

    const summary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-08-18T12:00:00Z"),
    );

    expect(summary.grossRevenueTodayCents).toBe(0);
    expect(summary.paidOrdersTodayCount).toBe(0);
    expect(summary.avgOrderValueCents).toBeNull();
    expect(summary.openOrdersCount).toBe(0);
    expect(summary.paymentFailuresTodayCount).toBe(0);
  });

  it("counts open orders (received/accepted/preparing/ready) and today's payment failures/flagged-for-review", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const asOf = new Date("2026-08-18T12:00:00Z");
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

    await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1200,
      status: "received",
    });
    await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1300,
      status: "preparing",
    });
    // Completed order does not count as "open".
    await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1400,
      status: "completed",
    });

    const failedOrderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 900,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId: failedOrderId,
      amountCents: 900,
      status: "failed",
      createdAt: new Date("2026-08-18T08:00:00Z"),
    });

    const flaggedOrderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 700,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId: flaggedOrderId,
      amountCents: 700,
      status: "flagged_for_review",
      createdAt: new Date("2026-08-18T08:30:00Z"),
    });

    const summary = await getSummary(seed.managerId, fixture.tenantA.tenantId, asOf);

    expect(summary.openOrdersCount).toBe(2);
    expect(summary.paymentFailuresTodayCount).toBe(2);
  });

  it("resolves 'today' using the tenant's own restaurant_profiles.timezone, not UTC (a payment just before UTC midnight on the day before is still 'today' in Europe/Berlin)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name, timezone) values ($1, 'Test Restaurant', 'Europe/Berlin')`,
      [fixture.tenantA.tenantId],
    );
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

    // 2026-08-17T22:30:00Z is 2026-08-18T00:30:00+02:00 (CEST) in Europe/Berlin --
    // "today" local, even though it's still "yesterday" in UTC.
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1800,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 1800,
      status: "paid",
      createdAt: new Date("2026-08-17T22:30:00Z"),
    });

    // "as of" 2026-08-18T10:00:00Z = 2026-08-18T12:00:00+02:00 local -- same local day as the payment.
    const summary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-08-18T10:00:00Z"),
    );

    expect(summary.paidOrdersTodayCount).toBe(1);
    expect(summary.grossRevenueTodayCents).toBe(1800);
  });

  it("correctly resolves the local day across the 2026 Europe/Berlin spring-forward DST transition (2026-03-29, clocks jump 02:00 -> 03:00 CEST)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name, timezone) values ($1, 'Test Restaurant', 'Europe/Berlin')`,
      [fixture.tenantA.tenantId],
    );
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

    // 2026-03-29T00:30:00Z = 2026-03-29T01:30:00+01:00 (CET, still standard
    // time -- the jump to CEST happens at 02:00 local, i.e. 01:00Z) -- this
    // payment falls on the local calendar day 2026-03-29.
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 3300,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 3300,
      status: "paid",
      createdAt: new Date("2026-03-29T00:30:00Z"),
    });

    // "as of" later the same local day, well after the DST jump.
    const summary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-03-29T12:00:00Z"),
    );

    expect(summary.paidOrdersTodayCount).toBe(1);
    expect(summary.grossRevenueTodayCents).toBe(3300);

    // A payment made "as of" the PREVIOUS local day must not be included.
    const previousDaySummary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-03-28T12:00:00Z"),
    );
    expect(previousDaySummary.paidOrdersTodayCount).toBe(0);
  });

  it("correctly resolves the local day across the 2026 Europe/Berlin fall-back DST transition (2026-10-25, clocks jump 03:00 -> 02:00 CEST/CET)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name, timezone) values ($1, 'Test Restaurant', 'Europe/Berlin')`,
      [fixture.tenantA.tenantId],
    );
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

    // 2026-10-25T01:30:00Z = 2026-10-25T02:30:00 CET (after the fall-back, the
    // 02:00-03:00 local hour happens twice; Postgres's tz-database-driven
    // conversion resolves this correctly either way) -- falls on local
    // calendar day 2026-10-25.
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 5500,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 5500,
      status: "paid",
      createdAt: new Date("2026-10-25T01:30:00Z"),
    });

    const summary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-10-25T20:00:00Z"),
    );

    expect(summary.paidOrdersTodayCount).toBe(1);
    expect(summary.grossRevenueTodayCents).toBe(5500);
  });

  it("denies a member without analytics.read (permission-denied case)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;

    await expect(
      queryAsUser(
        admin,
        seed.staffId,
        `select get_analytics_dashboard_summary($1, $2) as summary`,
        [fixture.tenantB.tenantId, new Date("2026-08-18T12:00:00Z").toISOString()],
      ),
    ).rejects.toThrow(/insufficient_privilege|permission/i);
  });

  it("never leaks another tenant's analytics via a client-supplied tenant_id (cross-tenant isolation)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const accountId = await ensurePaymentAccount(admin, fixture.tenantB.tenantId);
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantB.tenantId,
      totalCents: 9900,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantB.tenantId,
      orderId,
      amountCents: 9900,
      status: "paid",
      createdAt: new Date("2026-08-18T09:00:00Z"),
    });

    // seed.managerId is a manager (has analytics.read) only in tenantA -- must
    // not be able to read tenantB's summary by passing tenantB's tenant_id.
    await expect(
      queryAsUser(
        admin,
        seed.managerId,
        `select get_analytics_dashboard_summary($1, $2) as summary`,
        [fixture.tenantB.tenantId, new Date("2026-08-18T12:00:00Z").toISOString()],
      ),
    ).rejects.toThrow(/insufficient_privilege|permission/i);

    // Sanity check: tenantB's own owner (has analytics.read via the Owner
    // role) can see it -- proves the rejection above is cross-tenant denial,
    // not a broken function.
    const summary = await getSummary(
      fixture.tenantB.ownerId,
      fixture.tenantB.tenantId,
      new Date("2026-08-18T12:00:00Z"),
    );
    expect(summary.grossRevenueTodayCents).toBe(9900);
  });

  it("also uses the default 'Europe/Berlin' timezone when a tenant has not yet created a restaurant_profiles row", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);
    const orderId = await seedOrder(admin, {
      tenantId: fixture.tenantA.tenantId,
      totalCents: 1000,
    });
    await seedPayment(admin, accountId, {
      tenantId: fixture.tenantA.tenantId,
      orderId,
      amountCents: 1000,
      status: "paid",
      createdAt: new Date("2026-08-17T22:30:00Z"),
    });

    const summary = await getSummary(
      seed.managerId,
      fixture.tenantA.tenantId,
      new Date("2026-08-18T10:00:00Z"),
    );

    expect(summary.timezone).toBe("Europe/Berlin");
    expect(summary.paidOrdersTodayCount).toBe(1);
  });
});

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  expectCrossTenantDenied,
  queryAsUser,
  seedTwoTenantFixture,
  type TwoTenantFixture,
} from "@gastro-saas/testing";

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
    throw new Error(`[refunds.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[refunds.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

interface Seeded {
  orderId: string;
  paymentId: string;
}

/**
 * Seeds an order + charge-ready payment_accounts + a `paid` payments row for
 * `tenantId`, bypassing the checkout/webhook flow (out of this ticket's own
 * scope -- ticket #21/#24/#25 already cover that path end to end). This
 * ticket's own concern is the `refunds` table and its guard triggers, which
 * only need a valid `payments` row to point at.
 */
async function seedPaidPayment(
  admin: Client,
  tenantId: string,
  amountCents = 2000,
): Promise<Seeded> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', $4)`,
    [orderId, tenantId, tokenHash, amountCents],
  );

  const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await admin.query(
    `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
     values ($1, $2, 'enabled', true, true)
     on conflict (tenant_id) do update set stripe_account_id = excluded.stripe_account_id, charges_enabled = true`,
    [tenantId, stripeAccountId],
  );

  const paymentId = randomUUID();
  await admin.query(
    `insert into payments (id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'EUR', 'paid')`,
    [
      paymentId,
      tenantId,
      orderId,
      `cs_test_${randomUUID().replace(/-/g, "")}`,
      `pi_test_${randomUUID().replace(/-/g, "")}`,
      stripeAccountId,
      amountCents,
    ],
  );

  return { orderId, paymentId };
}

describe.skipIf(!dbAvailable)("refunds (ticket #26, risk:payment)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      // Deletion order matters: refunds -> payments -> orders, since all
      // three are `on delete restrict` by design (never silently lose a
      // financial record) -- deleting orders first (as an earlier draft of
      // this cleanup did) trips the payments_order_id_fkey/refunds_*_fkey
      // constraints.
      await admin.query(`delete from refunds where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from payments where tenant_id in ($1, $2)`, [
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

  it("issues a full refund and transitions it pending -> succeeded", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    const insertResult = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
       values ($1, $2, $3, 2000, 'EUR', 'Volle Rückerstattung', $4) returning id, status`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    expect(insertResult.rows[0]!.status).toBe("pending");
    const refundId = insertResult.rows[0]!.id as string;

    await queryAsUser(
      admin,
      seed.managerId,
      `update refunds set status = 'succeeded', stripe_refund_id = $2 where id = $1`,
      [refundId, `re_test_${randomUUID().replace(/-/g, "")}`],
    );

    const refundRow = await admin.query(
      `select status, stripe_refund_id from refunds where id = $1`,
      [refundId],
    );
    expect(refundRow.rows[0].status).toBe("succeeded");
    expect(refundRow.rows[0].stripe_refund_id).toMatch(/^re_test_/);
  });

  it("supports multiple partial refunds against the same payment, summing exactly to the paid amount", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    const first = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
       values ($1, $2, $3, 700, 'EUR', 'erste Teilerstattung', $4, 'succeeded') returning id`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    expect(first.rows).toHaveLength(1);

    const second = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
       values ($1, $2, $3, 1300, 'EUR', 'Rest erstatten', $4, 'succeeded') returning id`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    expect(second.rows).toHaveLength(1);

    const total = await admin.query(
      `select coalesce(sum(amount_cents), 0)::int as total from refunds where payment_id = $1 and status = 'succeeded'`,
      [paymentId],
    );
    expect(total.rows[0].total).toBe(2000);

    // A third refund of even 1 cent now exceeds the paid amount.
    await expect(
      queryAsUser(
        admin,
        seed.managerId,
        `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
         values ($1, $2, $3, 1, 'EUR', 'zu viel', $4)`,
        [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
      ),
    ).rejects.toThrow(/exceed the paid amount/i);
  });

  it("rejects a single refund request that alone exceeds the paid amount", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    await expect(
      queryAsUser(
        admin,
        seed.managerId,
        `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
         values ($1, $2, $3, 2001, 'EUR', 'zu viel', $4)`,
        [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
      ),
    ).rejects.toThrow(/exceed the paid amount/i);
  });

  it("rejects a refund against a payment that is not status='paid'", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);
    await admin.query(`update payments set status = 'flagged_for_review' where id = $1`, [
      paymentId,
    ]);

    await expect(
      queryAsUser(
        admin,
        seed.managerId,
        `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
         values ($1, $2, $3, 100, 'EUR', 'grund', $4)`,
        [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
      ),
    ).rejects.toThrow(/status 'paid'/i);
  });

  it("a failed refund attempt does not count against the remaining refundable amount, and a following full-amount refund succeeds", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    const failedAttempt = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
       values ($1, $2, $3, 2000, 'EUR', 'erster Versuch', $4) returning id`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    await queryAsUser(admin, seed.managerId, `update refunds set status = 'failed' where id = $1`, [
      failedAttempt.rows[0]!.id,
    ]);

    // The full amount is still refundable -- the failed attempt released its reservation.
    const retry = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
       values ($1, $2, $3, 2000, 'EUR', 'erneuter Versuch', $4) returning id, status`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    expect(retry.rows[0]!.status).toBe("pending");
  });

  // Regression test for the epic-7 batch review cycle-2 HIGH finding: an
  // 'unconfirmed' refund (ambiguous Stripe failure -- see refund-service.ts's
  // module header) must block ANY further refund attempt against the same
  // payment, not just ones that would exceed the amount headroom. Previously
  // only the running-total amount check existed, so a second, smaller
  // attempt could still reach Stripe with its own fresh idempotency key
  // while the first attempt's real outcome at Stripe was still unknown.
  it("rejects any further refund insert while an unconfirmed refund exists for the same payment, even with amount headroom", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    const ambiguousAttempt = await queryAsUser(
      admin,
      seed.managerId,
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
       values ($1, $2, $3, 200, 'EUR', 'Netzwerkfehler, Ausgang unklar', $4) returning id`,
      [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
    );
    await queryAsUser(
      admin,
      seed.managerId,
      `update refunds set status = 'unconfirmed' where id = $1`,
      [ambiguousAttempt.rows[0]!.id],
    );

    // Only 200 of 2000 cents is reserved -- plenty of amount headroom for a
    // 100-cent second attempt, so only the existence check (not the amount
    // check) can be what blocks it.
    await expect(
      queryAsUser(
        admin,
        seed.managerId,
        `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
         values ($1, $2, $3, 100, 'EUR', 'zweiter Versuch', $4)`,
        [fixture.tenantA.tenantId, paymentId, orderId, seed.managerId],
      ),
    ).rejects.toThrow(/unconfirmed refund pending manual reconciliation/i);
  });

  it("denies a refund insert from a member without payments.refund (permission-denied case)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantB.tenantId, 2000);

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: seed.staffId,
      sql: `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
            values ($1, $2, $3, 500, 'EUR', 'grund', $4) returning id`,
      params: [fixture.tenantB.tenantId, paymentId, orderId, seed.staffId],
    });

    const refundCount = await admin.query(
      `select count(*)::int as count from refunds where payment_id = $1`,
      [paymentId],
    );
    expect(refundCount.rows[0].count).toBe(0);
  });

  it("never leaks or lets one tenant's payment be refunded via another tenant's membership (cross-tenant isolation)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantA.tenantId, 2000);

    // tenantB's manager (has payments.refund in their own tenant) cannot
    // refund tenantA's payment by claiming tenantA's tenant_id -- RLS denies
    // it because has_tenant_permission is evaluated for the *acting* user's
    // own membership, which has no role in tenantA at all.
    await expectCrossTenantDenied({
      client: admin,
      actorUserId: fixture.tenantB.ownerId,
      sql: `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
            values ($1, $2, $3, 500, 'EUR', 'grund', $4) returning id`,
      params: [fixture.tenantA.tenantId, paymentId, orderId, fixture.tenantB.ownerId],
    });

    const refundCount = await admin.query(
      `select count(*)::int as count from refunds where payment_id = $1`,
      [paymentId],
    );
    expect(refundCount.rows[0].count).toBe(0);

    // Even the tenantA owner cannot smuggle a cross-tenant reference by
    // passing tenantB's own tenant_id alongside tenantA's payment/order id --
    // the ensure_refund_matches_payment_and_within_limit() trigger's own
    // tenant-match check rejects it independently of RLS.
    await expect(
      queryAsUser(
        admin,
        fixture.tenantA.ownerId,
        `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id)
         values ($1, $2, $3, 500, 'EUR', 'grund', $4)`,
        [fixture.tenantB.tenantId, paymentId, orderId, fixture.tenantA.ownerId],
      ),
    ).rejects.toThrow(/permission denied|row-level security|must match its payment/i);
  });

  it("restricts refund/payment history reads to members holding payments.read", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { paymentId } = await seedPaidPayment(admin, fixture.tenantB.tenantId, 2000);

    // staff (no payments.read) sees nothing.
    const asStaff = await queryAsUser(
      admin,
      seed.staffId,
      `select id from payments where id = $1`,
      [paymentId],
    );
    expect(asStaff.rows).toHaveLength(0);

    // tenantB's owner (payments.read via the Owner role, which holds every
    // permission) sees the payment.
    const asOwner = await queryAsUser(
      admin,
      fixture.tenantB.ownerId,
      `select id from payments where id = $1`,
      [paymentId],
    );
    expect(asOwner.rows).toHaveLength(1);
  });

  it("never leaks payments/orders reads across tenants via payments_select_payments_read/orders_select_payments_read, even for a holder of payments.read in their OWN tenant (Opus epic-7 batch review finding 2)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { orderId, paymentId } = await seedPaidPayment(admin, fixture.tenantB.tenantId, 2000);

    // seed.managerId holds payments.read/payments.refund, but only in
    // tenantA -- has_tenant_permission(tenant_id, 'payments.read') must
    // evaluate false for tenantB's rows regardless of that unrelated grant.
    const paymentsAsTenantAManager = await queryAsUser(
      admin,
      seed.managerId,
      `select id from payments where id = $1`,
      [paymentId],
    );
    expect(paymentsAsTenantAManager.rows).toHaveLength(0);

    const ordersAsTenantAManager = await queryAsUser(
      admin,
      seed.managerId,
      `select id from orders where id = $1`,
      [orderId],
    );
    expect(ordersAsTenantAManager.rows).toHaveLength(0);

    // Sanity check: tenantB's own owner (payments.read via the Owner role)
    // can see both rows -- proves the empty results above are cross-tenant
    // denial, not a broken policy that hides everything from everyone.
    const paymentsAsTenantBOwner = await queryAsUser(
      admin,
      fixture.tenantB.ownerId,
      `select id from payments where id = $1`,
      [paymentId],
    );
    expect(paymentsAsTenantBOwner.rows).toHaveLength(1);

    const ordersAsTenantBOwner = await queryAsUser(
      admin,
      fixture.tenantB.ownerId,
      `select id from orders where id = $1`,
      [orderId],
    );
    expect(ordersAsTenantBOwner.rows).toHaveLength(1);
  });
});

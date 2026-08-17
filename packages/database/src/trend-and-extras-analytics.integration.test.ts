// Integration tests for `get_trend_period_stats()` and
// `get_extras_performance_stats()` (ticket #32, Epic 9 "Trendvergleiche und
// Extras-Analytics"). Same DB-probe/skip pattern as the other database
// integration suites.
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
    throw new Error(
      `[trend-and-extras-analytics.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[trend-and-extras-analytics.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

interface SeedOrderOptions {
  tenantId: string;
  totalCents: number;
  status?: string;
}

/** Seeds an order, bypassing checkout (out of this ticket's scope). Walks the real state machine. */
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

interface SeedPaymentOptions {
  tenantId: string;
  orderId: string;
  amountCents: number;
  status: "pending" | "paid" | "failed" | "cancelled" | "flagged_for_review";
  createdAt: Date;
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

interface SeededMenu {
  menuVersionId: string;
  categoryId: string;
  dishId: string;
  optionGroupId: string;
  optionId: string;
}

/** Seeds a published menu version with one dish assigned to one option group with one option, all created while the version is still draft (dishes/options-assignments are read-only once published). */
async function seedPublishedMenuWithOption(admin: Client, tenantId: string): Promise<SeededMenu> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const optionGroupId = randomUUID();
  const optionId = randomUUID();

  await admin.query(`insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`, [
    menuVersionId,
    tenantId,
  ]);
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );
  await admin.query(
    `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
     values ($1, $2, $3, $4, 'Margherita', 1000, true)`,
    [dishId, tenantId, menuVersionId, categoryId],
  );
  await admin.query(
    `insert into option_groups (id, tenant_id, name, min_selections, max_selections)
     values ($1, $2, 'Extras', 0, 2)`,
    [optionGroupId, tenantId],
  );
  await admin.query(
    `insert into options (id, tenant_id, option_group_id, name, price_delta_cents) values ($1, $2, $3, 'Extra Käse', 150)`,
    [optionId, tenantId, optionGroupId],
  );
  await admin.query(
    `insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id) values ($1, $2, $3)`,
    [dishId, optionGroupId, tenantId],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return { menuVersionId, categoryId, dishId, optionGroupId, optionId };
}

async function addOrderItemWithSelection(
  admin: Client,
  tenantId: string,
  orderId: string,
  menu: SeededMenu,
  withSelection: boolean,
): Promise<void> {
  const orderItemId = randomUUID();
  await admin.query(
    `insert into order_items (id, tenant_id, order_id, dish_id, quantity, dish_name_snapshot, unit_price_cents_snapshot, currency)
     values ($1, $2, $3, $4, 1, 'Margherita', 1000, 'EUR')`,
    [orderItemId, tenantId, orderId, menu.dishId],
  );
  if (withSelection) {
    await admin.query(
      `insert into order_item_selections (tenant_id, order_item_id, option_id, option_name_snapshot, price_delta_cents_snapshot)
       values ($1, $2, $3, 'Extra Käse', 150)`,
      [tenantId, orderItemId, menu.optionId],
    );
  }
}

describe.skipIf(!dbAvailable)(
  "get_trend_period_stats() / get_extras_performance_stats() (ticket #32)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterEach(async () => {
      if (fixture) {
        // payments/orders.tenant_id are both `on delete restrict` -- see
        // #30/#31's precedent. payments.order_id references orders, so
        // payments must be deleted before orders. dishes/categories/
        // menu_versions/option_groups/options are intentionally NOT manually
        // deleted -- they cascade fine when the fixture's own cleanup()
        // deletes the tenants below (manually deleting them first would hit
        // ensure_menu_version_editable()'s "read-only once published" guard
        // while the menu_versions row still exists).
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

    async function getTrendStats(
      actorUserId: string,
      tenantId: string,
      periodType: string,
      asOf: Date,
      customStart?: string,
      customEnd?: string,
    ): Promise<Record<string, unknown>> {
      const result = await queryAsUser(
        admin,
        actorUserId,
        `select get_trend_period_stats($1, $2, $3, $4, $5) as stats`,
        [tenantId, periodType, asOf.toISOString(), customStart ?? null, customEnd ?? null],
      );
      return result.rows[0]!.stats as Record<string, unknown>;
    }

    async function getExtrasStats(
      actorUserId: string,
      tenantId: string,
      daysBack?: number,
    ): Promise<Array<Record<string, unknown>>> {
      const result =
        daysBack !== undefined
          ? await queryAsUser(
              admin,
              actorUserId,
              `select get_extras_performance_stats($1, $2) as stats`,
              [tenantId, daysBack],
            )
          : await queryAsUser(
              admin,
              actorUserId,
              `select get_extras_performance_stats($1) as stats`,
              [tenantId],
            );
      return result.rows[0]!.stats as Array<Record<string, unknown>>;
    }

    describe("get_trend_period_stats()", () => {
      it("compares today vs yesterday correctly", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

        const asOf = new Date("2026-08-18T15:00:00Z");
        const todayOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 3000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: todayOrderId,
          amountCents: 3000,
          status: "paid",
          createdAt: new Date("2026-08-18T10:00:00Z"),
        });
        const yesterdayOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 2000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: yesterdayOrderId,
          amountCents: 2000,
          status: "paid",
          createdAt: new Date("2026-08-17T10:00:00Z"),
        });

        const stats = await getTrendStats(seed.managerId, fixture.tenantA.tenantId, "day", asOf);
        const current = stats.currentPeriod as Record<string, unknown>;
        const previous = stats.previousPeriod as Record<string, unknown>;

        expect(current.grossRevenueCents).toBe(3000);
        expect(current.paidOrdersCount).toBe(1);
        expect(previous.grossRevenueCents).toBe(2000);
        expect(previous.paidOrdersCount).toBe(1);
      });

      it("marks the current period incomplete when p_as_of is still inside it, and complete once it has fully elapsed", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        const midDay = new Date("2026-08-18T12:00:00Z");
        const stats = await getTrendStats(seed.managerId, fixture.tenantA.tenantId, "day", midDay);
        expect((stats.currentPeriod as Record<string, unknown>).isComplete).toBe(false);
        // The PREVIOUS day, relative to this same "now", is always fully elapsed.
        expect((stats.previousPeriod as Record<string, unknown>).isComplete).toBe(true);
      });

      it("compares this week vs the previous week using Monday-start (ISO) week boundaries", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

        // 2026-08-18 is a Tuesday -- this ISO week is 2026-08-17 (Mon) through
        // 2026-08-23 (Sun). A payment on 2026-08-17 (the Monday) is IN this
        // week; a payment on 2026-08-16 (the prior Sunday) is in the previous week.
        const asOf = new Date("2026-08-18T12:00:00Z");
        const thisWeekOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 5000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: thisWeekOrderId,
          amountCents: 5000,
          status: "paid",
          createdAt: new Date("2026-08-17T08:00:00Z"),
        });
        const lastWeekOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 4000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: lastWeekOrderId,
          amountCents: 4000,
          status: "paid",
          createdAt: new Date("2026-08-16T08:00:00Z"),
        });

        const stats = await getTrendStats(seed.managerId, fixture.tenantA.tenantId, "week", asOf);
        expect((stats.currentPeriod as Record<string, unknown>).grossRevenueCents).toBe(5000);
        expect((stats.previousPeriod as Record<string, unknown>).grossRevenueCents).toBe(4000);
      });

      it("compares this month vs the previous month", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

        const asOf = new Date("2026-08-18T12:00:00Z");
        const thisMonthOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 7000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: thisMonthOrderId,
          amountCents: 7000,
          status: "paid",
          createdAt: new Date("2026-08-05T08:00:00Z"),
        });
        const lastMonthOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 6000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: lastMonthOrderId,
          amountCents: 6000,
          status: "paid",
          createdAt: new Date("2026-07-25T08:00:00Z"),
        });

        const stats = await getTrendStats(seed.managerId, fixture.tenantA.tenantId, "month", asOf);
        expect((stats.currentPeriod as Record<string, unknown>).grossRevenueCents).toBe(7000);
        expect((stats.previousPeriod as Record<string, unknown>).grossRevenueCents).toBe(6000);
      });

      it("compares a custom range against an equal-length preceding period", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

        // Custom range: 2026-08-10 through 2026-08-14 inclusive (5 days) ->
        // p_custom_start='2026-08-10', p_custom_end='2026-08-15' (exclusive).
        // Equal-length previous period: 2026-08-05 through 2026-08-09 (5 days).
        const currentOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 9000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: currentOrderId,
          amountCents: 9000,
          status: "paid",
          createdAt: new Date("2026-08-12T08:00:00Z"),
        });
        const previousOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 3000,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId: previousOrderId,
          amountCents: 3000,
          status: "paid",
          createdAt: new Date("2026-08-07T08:00:00Z"),
        });

        const stats = await getTrendStats(
          seed.managerId,
          fixture.tenantA.tenantId,
          "custom",
          new Date("2026-08-18T00:00:00Z"),
          "2026-08-10",
          "2026-08-15",
        );
        expect((stats.currentPeriod as Record<string, unknown>).grossRevenueCents).toBe(9000);
        expect((stats.previousPeriod as Record<string, unknown>).grossRevenueCents).toBe(3000);
      });

      it("rejects an invalid period_type", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        await expect(
          getTrendStats(seed.managerId, fixture.tenantA.tenantId, "year", new Date()),
        ).rejects.toThrow(/p_period_type must be one of/i);
      });

      it("rejects a custom range with a missing or backwards end date", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        await expect(
          getTrendStats(
            seed.managerId,
            fixture.tenantA.tenantId,
            "custom",
            new Date(),
            "2026-08-15",
            "2026-08-10",
          ),
        ).rejects.toThrow(/p_custom_start and p_custom_end/i);
      });

      it("resolves week/month boundaries across the 2026 Europe/Berlin DST transitions", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        await admin.query(
          `insert into restaurant_profiles (tenant_id, display_name, timezone) values ($1, 'Test Restaurant', 'Europe/Berlin')`,
          [fixture.tenantA.tenantId],
        );
        const accountId = await ensurePaymentAccount(admin, fixture.tenantA.tenantId);

        // Spring-forward week: 2026-03-29 is a Sunday, the last day of the ISO
        // week starting 2026-03-23 (Mon). A payment made just after the DST
        // jump (2026-03-29T01:30:00Z = 2026-03-29T03:30:00 CEST) must still
        // fall in that same week.
        const orderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 4400,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantA.tenantId,
          orderId,
          amountCents: 4400,
          status: "paid",
          createdAt: new Date("2026-03-29T01:30:00Z"),
        });

        // "As of" later the same Sunday (2026-03-29), still within the ISO
        // week that started Monday 2026-03-23 -- NOT the following Monday
        // (2026-03-30), which would already be the NEXT week.
        const stats = await getTrendStats(
          seed.managerId,
          fixture.tenantA.tenantId,
          "week",
          new Date("2026-03-29T20:00:00Z"),
        );
        expect((stats.currentPeriod as Record<string, unknown>).grossRevenueCents).toBe(4400);
      });

      it("denies a member without analytics.read (permission-denied case)", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        await expect(
          getTrendStats(seed.staffId, fixture.tenantB.tenantId, "day", new Date()),
        ).rejects.toThrow(/insufficient_privilege|permission/i);
      });

      it("never leaks another tenant's trend stats via a client-supplied tenant_id (cross-tenant isolation)", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const accountId = await ensurePaymentAccount(admin, fixture.tenantB.tenantId);
        const orderId = await seedOrder(admin, {
          tenantId: fixture.tenantB.tenantId,
          totalCents: 8800,
        });
        await seedPayment(admin, accountId, {
          tenantId: fixture.tenantB.tenantId,
          orderId,
          amountCents: 8800,
          status: "paid",
          createdAt: new Date("2026-08-18T09:00:00Z"),
        });

        await expect(
          getTrendStats(
            seed.managerId,
            fixture.tenantB.tenantId,
            "day",
            new Date("2026-08-18T12:00:00Z"),
          ),
        ).rejects.toThrow(/insufficient_privilege|permission/i);

        const stats = await getTrendStats(
          fixture.tenantB.ownerId,
          fixture.tenantB.tenantId,
          "day",
          new Date("2026-08-18T12:00:00Z"),
        );
        expect((stats.currentPeriod as Record<string, unknown>).grossRevenueCents).toBe(8800);
      });
    });

    describe("get_extras_performance_stats()", () => {
      it("computes selection count, eligible order item count, and additional revenue correctly", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const menu = await seedPublishedMenuWithOption(admin, fixture.tenantA.tenantId);

        const orderWithExtraId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 1150,
          status: "completed",
        });
        await addOrderItemWithSelection(
          admin,
          fixture.tenantA.tenantId,
          orderWithExtraId,
          menu,
          true,
        );

        const orderWithoutExtraId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 1000,
          status: "completed",
        });
        await addOrderItemWithSelection(
          admin,
          fixture.tenantA.tenantId,
          orderWithoutExtraId,
          menu,
          false,
        );

        const stats = await getExtrasStats(seed.managerId, fixture.tenantA.tenantId);
        const extraCheese = stats.find((s) => s.optionId === menu.optionId)!;

        expect(extraCheese.eligibleOrderItemCount).toBe(2);
        expect(extraCheese.selectionCount).toBe(1);
        expect(extraCheese.additionalRevenueCents).toBe(150);
      });

      it("excludes orders still awaiting_payment or cancelled from both eligible and selection counts", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const menu = await seedPublishedMenuWithOption(admin, fixture.tenantA.tenantId);

        const awaitingPaymentOrderId = await seedOrder(admin, {
          tenantId: fixture.tenantA.tenantId,
          totalCents: 1150,
        });
        await addOrderItemWithSelection(
          admin,
          fixture.tenantA.tenantId,
          awaitingPaymentOrderId,
          menu,
          true,
        );

        const stats = await getExtrasStats(seed.managerId, fixture.tenantA.tenantId);
        const extraCheese = stats.find((s) => s.optionId === menu.optionId)!;
        expect(extraCheese.eligibleOrderItemCount).toBe(0);
        expect(extraCheese.selectionCount).toBe(0);
      });

      it("returns an empty array when the tenant has no published menu (honest empty state)", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        const stats = await getExtrasStats(seed.managerId, fixture.tenantA.tenantId);
        expect(stats).toEqual([]);
      });

      it("rejects a non-positive p_days_back", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        await expect(getExtrasStats(seed.managerId, fixture.tenantA.tenantId, 0)).rejects.toThrow(
          /p_days_back must be a positive integer/i,
        );
      });

      it("denies a member without analytics.read (permission-denied case)", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;

        await expect(getExtrasStats(seed.staffId, fixture.tenantB.tenantId)).rejects.toThrow(
          /insufficient_privilege|permission/i,
        );
      });

      it("never leaks another tenant's extras stats via a client-supplied tenant_id (cross-tenant isolation)", async () => {
        const seed = await seedFixtureWithManager();
        fixture = seed.fixture;
        const menu = await seedPublishedMenuWithOption(admin, fixture.tenantB.tenantId);
        const orderId = await seedOrder(admin, {
          tenantId: fixture.tenantB.tenantId,
          totalCents: 1150,
          status: "completed",
        });
        await addOrderItemWithSelection(admin, fixture.tenantB.tenantId, orderId, menu, true);

        await expect(getExtrasStats(seed.managerId, fixture.tenantB.tenantId)).rejects.toThrow(
          /insufficient_privilege|permission/i,
        );

        const stats = await getExtrasStats(fixture.tenantB.ownerId, fixture.tenantB.tenantId);
        expect(stats.find((s) => s.optionId === menu.optionId)!.selectionCount).toBe(1);
      });
    });
  },
);

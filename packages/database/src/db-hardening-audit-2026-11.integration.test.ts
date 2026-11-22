import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  expectCrossTenantDenied,
  queryAsUser,
  seedTwoTenantFixture,
  type TwoTenantFixture,
} from "@gastro-saas/testing";

// Issue #205: database hardening after the 2026-11 audit. One describe per
// audit item; each has a denied and an allowed case, two tenants where the
// item is tenant-scoped.

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
      `[db-hardening-audit-2026-11.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[db-hardening-audit-2026-11.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface SeededDish {
  menuVersionId: string;
  categoryId: string;
  dishId: string;
  variantId: string;
  extra: Array<{ dishId: string; variantId: string }>;
}

/** Seeds one published menu version (category, dish, variant) via the admin connection. */
async function seedPublishedDish(
  admin: Client,
  tenantId: string,
  name = "Margherita",
  versionNumber = 1,
  extraDishNames: string[] = [],
): Promise<SeededDish> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const variantId = randomUUID();
  await admin.query(
    `insert into menu_versions (id, tenant_id, status, version_number) values ($1, $2, 'draft', $3)`,
    [menuVersionId, tenantId, versionNumber],
  );
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );
  await admin.query(
    `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
     values ($1, $2, $3, $4, $5, 1000, true)`,
    [dishId, tenantId, menuVersionId, categoryId, name],
  );
  await admin.query(
    `insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available)
     values ($1, $2, $3, 'Groß', 1200, true)`,
    [variantId, tenantId, dishId],
  );
  const extra: Array<{ dishId: string; variantId: string }> = [];
  for (const extraName of extraDishNames) {
    const extraDishId = randomUUID();
    const extraVariantId = randomUUID();
    await admin.query(
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values ($1, $2, $3, $4, $5, 500, true)`,
      [extraDishId, tenantId, menuVersionId, categoryId, extraName],
    );
    await admin.query(
      `insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available)
       values ($1, $2, $3, 'Normal', 600, true)`,
      [extraVariantId, tenantId, extraDishId],
    );
    extra.push({ dishId: extraDishId, variantId: extraVariantId });
  }
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );
  return { menuVersionId, categoryId, dishId, variantId, extra };
}

async function seedPaidPayment(
  admin: Client,
  tenantId: string,
  amountCents = 2000,
): Promise<{ orderId: string; paymentId: string }> {
  const orderId = randomUUID();
  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', $4)`,
    [orderId, tenantId, sha256(randomUUID()), amountCents],
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

describe.skipIf(!dbAvailable)("database hardening after audit 2026-11 (issue #205)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture | undefined;
  const extraUserIds: string[] = [];
  let managerId: string;
  let staffId: string;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      const ids = [fixture.tenantA.tenantId, fixture.tenantB.tenantId];
      await admin.query(`delete from manual_sales_entries where tenant_id = any($1::uuid[])`, [
        ids,
      ]);
      await admin.query(`delete from refunds where tenant_id = any($1::uuid[])`, [ids]);
      await admin.query(`delete from payments where tenant_id = any($1::uuid[])`, [ids]);
      await admin.query(`delete from orders where tenant_id = any($1::uuid[])`, [ids]);
      await admin.query(`delete from payment_accounts where tenant_id = any($1::uuid[])`, [ids]);
    }
    await fixture?.cleanup();
    fixture = undefined;
    if (extraUserIds.length > 0) {
      await admin.query(`delete from auth.users where id = any($1::uuid[])`, [extraUserIds]);
      extraUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await admin.end();
  });

  async function seedFixture(): Promise<TwoTenantFixture> {
    managerId = randomUUID();
    staffId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: managerId, role: "manager" },
          { userId: staffId, role: "staff" },
        ],
      },
    });
    return fixture;
  }

  async function roleId(tenantId: string, key: string): Promise<string> {
    const role = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = $2`,
      [tenantId, key],
    );
    return role.rows[0]!.id;
  }

  async function membershipId(tenantId: string, userId: string): Promise<string> {
    const m = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantId, userId],
    );
    return m.rows[0]!.id;
  }

  let roleCounter = 0;
  async function customRole(tenantId: string, permissions: string[]): Promise<string> {
    roleCounter += 1;
    // roles.key allows lowercase letters and dashes only.
    const letters = "abcdefghij";
    const roleKey = `custom-${letters[roleCounter % 10]}${letters[Math.floor(roleCounter / 10) % 10]}`;
    const role = await admin.query<{ id: string }>(
      `insert into roles (tenant_id, key, name, description) values ($1, $2, 'Custom', 'test') returning id`,
      [tenantId, roleKey],
    );
    for (const permission of permissions) {
      await admin.query(`insert into role_permissions (role_id, permission_key) values ($1, $2)`, [
        role.rows[0]!.id,
        permission,
      ]);
    }
    return role.rows[0]!.id;
  }

  // ---- (1) refunds -------------------------------------------------------
  describe("refunds INSERT policy", () => {
    const insertSql = (status: string, refundId: string | null, actorParam: string) =>
      `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status, stripe_refund_id)
       values ($1, $2, $3, 100, 'EUR', 'grund', ${actorParam}, '${status}', ${refundId ? `'${refundId}'` : "null"})`;

    it("denies succeeded/unconfirmed rows, a fake stripe_refund_id and a foreign actor; allows the pending reservation", async () => {
      const f = await seedFixture();
      const { orderId, paymentId } = await seedPaidPayment(admin, f.tenantA.tenantId);
      const params = [f.tenantA.tenantId, paymentId, orderId, managerId];

      await expect(
        queryAsUser(admin, managerId, insertSql("succeeded", null, "$4"), params),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await expect(
        queryAsUser(admin, managerId, insertSql("unconfirmed", null, "$4"), params),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await expect(
        queryAsUser(admin, managerId, insertSql("pending", "re_fake123", "$4"), params),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await expect(
        queryAsUser(admin, managerId, insertSql("pending", null, "$4"), [
          f.tenantA.tenantId,
          paymentId,
          orderId,
          f.tenantA.ownerId,
        ]),
      ).rejects.toThrow(/row-level security|permission denied/i);

      await queryAsUser(admin, managerId, insertSql("pending", null, "$4"), params);
      const rows = await admin.query(`select status from refunds where payment_id = $1`, [
        paymentId,
      ]);
      expect(rows.rows).toEqual([{ status: "pending" }]);
    });

    it("keeps cross-tenant isolation (tenant B owner cannot reserve a refund on tenant A)", async () => {
      const f = await seedFixture();
      const { orderId, paymentId } = await seedPaidPayment(admin, f.tenantA.tenantId);
      await expectCrossTenantDenied({
        client: admin,
        actorUserId: f.tenantB.ownerId,
        sql: insertSql("pending", null, "$4"),
        params: [f.tenantA.tenantId, paymentId, orderId, f.tenantB.ownerId],
      });
    });
  });

  // ---- (2) accept_invitation --------------------------------------------
  describe("accept_invitation", () => {
    it("leaves the invitee with exactly the invited role", async () => {
      const f = await seedFixture();
      const email = `invitee-${randomUUID()}@example.test`;
      const userId = randomUUID();
      extraUserIds.push(userId);
      await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [userId, email]);
      const kitchen = await roleId(f.tenantA.tenantId, "kitchen");
      const tokenHash = sha256(randomUUID());

      await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
        [f.tenantA.tenantId, email, kitchen, tokenHash],
      );
      await queryAsUser(admin, userId, `select accept_invitation($1)`, [tokenHash]);

      const roles = await admin.query<{ role_id: string }>(
        `select mr.role_id
           from membership_roles mr
           join tenant_memberships tm on tm.id = mr.membership_id
          where tm.tenant_id = $1 and tm.user_id = $2`,
        [f.tenantA.tenantId, userId],
      );
      expect(roles.rows.map((r) => r.role_id)).toEqual([kitchen]);
    });

    it("rejects a user who already belongs to any tenant", async () => {
      const f = await seedFixture();
      const tokenHash = sha256(randomUUID());
      await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
        [
          f.tenantA.tenantId,
          f.tenantB.ownerEmail,
          await roleId(f.tenantA.tenantId, "service"),
          tokenHash,
        ],
      );
      await expect(
        queryAsUser(admin, f.tenantB.ownerId, `select accept_invitation($1)`, [tokenHash]),
      ).rejects.toThrow(/already belongs to a tenant/i);

      const leaked = await admin.query(
        `select 1 from tenant_memberships where tenant_id = $1 and user_id = $2`,
        [f.tenantA.tenantId, f.tenantB.ownerId],
      );
      expect(leaked.rows).toHaveLength(0);
    });
  });

  // ---- (3) role escalation ----------------------------------------------
  describe("role escalation", () => {
    it("denies assigning a role beyond the caller's permissions, allows a subset role; owner with roles.manage may assign anything", async () => {
      const f = await seedFixture();
      const staffMembership = await membershipId(f.tenantA.tenantId, staffId);
      const strongRole = await customRole(f.tenantA.tenantId, ["payments.connect"]);
      const weakRole = await customRole(f.tenantA.tenantId, ["orders.cancel"]);

      await expect(
        queryAsUser(
          admin,
          managerId,
          `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
          [staffMembership, strongRole],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);

      await queryAsUser(
        admin,
        managerId,
        `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
        [staffMembership, weakRole],
      );

      await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
        [staffMembership, strongRole],
      );

      const held = await admin.query(
        `select role_id from membership_roles where membership_id = $1 and role_id = any($2::uuid[])`,
        [staffMembership, [strongRole, weakRole]],
      );
      expect(held.rows).toHaveLength(2);
    });

    it("denies inviting into a more powerful role, allows a subset role", async () => {
      const f = await seedFixture();
      const strongRole = await customRole(f.tenantA.tenantId, ["payments.connect"]);
      const weakRole = await customRole(f.tenantA.tenantId, ["orders.cancel"]);

      await expect(
        queryAsUser(
          admin,
          managerId,
          `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
          [f.tenantA.tenantId, `a-${randomUUID()}@example.test`, strongRole, sha256(randomUUID())],
        ),
      ).rejects.toThrow(/roles\.manage/i);

      const ok = await queryAsUser(
        admin,
        managerId,
        `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
        [f.tenantA.tenantId, `b-${randomUUID()}@example.test`, weakRole, sha256(randomUUID())],
      );
      expect(ok.rows).toHaveLength(1);
    });
  });

  // ---- (12) export_tenant_data is Owner-only -----------------------------
  describe("export_tenant_data", () => {
    it("denies a Manager calling the RPC directly, allows the Owner", async () => {
      const f = await seedFixture();

      await expect(
        queryAsUser(admin, managerId, `select export_tenant_data($1)`, [f.tenantA.tenantId]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);

      const ok = await queryAsUser<{ export_tenant_data: { tenantId: string } }>(
        admin,
        f.tenantA.ownerId,
        `select export_tenant_data($1)`,
        [f.tenantA.tenantId],
      );
      expect(ok.rows[0]!.export_tenant_data.tenantId).toBe(f.tenantA.tenantId);
    });

    it("denies another tenant's Owner", async () => {
      const f = await seedFixture();
      await expect(
        queryAsUser(admin, f.tenantB.ownerId, `select export_tenant_data($1)`, [
          f.tenantA.tenantId,
        ]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);
    });
  });

  // ---- (5) menu_versions ------------------------------------------------
  describe("menu_versions", () => {
    it("forces drafts on direct INSERT by an app role", async () => {
      const f = await seedFixture();
      const res = await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `insert into menu_versions (tenant_id, status, published_at) values ($1, 'published', now()) returning status, published_at`,
        [f.tenantA.tenantId],
      );
      expect(res.rows[0]).toEqual({ status: "draft", published_at: null });
    });

    it("allows DELETE only for drafts and never across tenants", async () => {
      const f = await seedFixture();
      const published = await seedPublishedDish(admin, f.tenantA.tenantId);
      const draftId = randomUUID();
      await admin.query(
        `insert into menu_versions (id, tenant_id, status, version_number) values ($1, $2, 'draft', 99)`,
        [draftId, f.tenantA.tenantId],
      );

      const deniedPublished = await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `delete from menu_versions where id = $1 returning id`,
        [published.menuVersionId],
      );
      expect(deniedPublished.rows).toHaveLength(0);

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: f.tenantB.ownerId,
        sql: `delete from menu_versions where id = $1 returning id`,
        params: [draftId],
      });

      const allowed = await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `delete from menu_versions where id = $1 returning id`,
        [draftId],
      );
      expect(allowed.rows).toHaveLength(1);
    });

    it("rejects moving a row out of a published version into a draft (OLD parent is checked)", async () => {
      const f = await seedFixture();
      const published = await seedPublishedDish(admin, f.tenantA.tenantId);
      const draftId = randomUUID();
      await admin.query(
        `insert into menu_versions (id, tenant_id, status, version_number) values ($1, $2, 'draft', 99)`,
        [draftId, f.tenantA.tenantId],
      );
      await expect(
        admin.query(`update categories set menu_version_id = $1 where id = $2`, [
          draftId,
          published.categoryId,
        ]),
      ).rejects.toThrow(/read-only once its menu version leaves draft/i);
    });
  });

  // ---- (6) manual_sales_entries -----------------------------------------
  describe("manual_sales_entries", () => {
    it("rejects a dish of another tenant and forces entered_by_user_id = auth.uid()", async () => {
      const f = await seedFixture();
      const dishA = await seedPublishedDish(admin, f.tenantA.tenantId);
      const dishB = await seedPublishedDish(admin, f.tenantB.tenantId, "Geheim");

      await expect(
        queryAsUser(
          admin,
          f.tenantA.ownerId,
          `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 1, current_date)`,
          [f.tenantA.tenantId, dishB.dishId],
        ),
      ).rejects.toThrow(/same tenant/i);

      const res = await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, entered_by_user_id)
         values ($1, $2, 1, current_date, $3) returning entered_by_user_id`,
        [f.tenantA.tenantId, dishA.dishId, f.tenantB.ownerId],
      );
      expect(res.rows[0]!.entered_by_user_id).toBe(f.tenantA.ownerId);
    });

    it("commit_sales_import_batch records the caller, not the supplied user id", async () => {
      const f = await seedFixture();
      const dishA = await seedPublishedDish(admin, f.tenantA.tenantId);
      const batch = await admin.query<{ id: string }>(
        `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count)
         values ($1, 'x.csv', '[]'::jsonb, '[]'::jsonb, 0) returning id`,
        [f.tenantA.tenantId],
      );
      await queryAsUser(
        admin,
        f.tenantA.ownerId,
        `select * from commit_sales_import_batch($1, $2, $3::jsonb, $4)`,
        [
          f.tenantA.tenantId,
          batch.rows[0]!.id,
          JSON.stringify([
            { dishId: dishA.dishId, quantity: 2, saleDate: "2026-09-01", channel: "" },
          ]),
          f.tenantB.ownerId,
        ],
      );
      const rows = await admin.query(
        `select entered_by_user_id from manual_sales_entries where tenant_id = $1`,
        [f.tenantA.tenantId],
      );
      expect(rows.rows).toEqual([{ entered_by_user_id: f.tenantA.ownerId }]);
    });
  });

  // ---- (7) function privileges ------------------------------------------
  describe("function EXECUTE privileges in schema public", () => {
    const ANON_ALLOW = ["get_public_legal_page", "get_public_menu"];
    const AUTHENTICATED_ALLOW = [
      "accept_invitation",
      "caller_covers_role_permissions",
      "commit_sales_import_batch",
      "create_initial_draft_menu_version",
      "create_integration_account",
      "create_invitation",
      "create_tenant_with_owner",
      "export_tenant_data",
      "get_analytics_dashboard_summary",
      "get_dish_performance_stats",
      "get_extras_performance_stats",
      "get_public_legal_page",
      "get_public_menu",
      // Added by PR #201 (Mollie); the allow-list may contain names that do not exist (yet).
      "get_mollie_connection_status",
      "get_tenant_order_payment_statuses",
      "get_trend_period_stats",
      "has_tenant_permission",
      "is_menu_item_available",
      "is_tenant_member",
      "is_tenant_owner",
      "is_valid_order_status_transition",
      "list_integration_accounts",
      "list_integration_sync_jobs",
      "list_tenant_ratings_for_moderation",
      "mark_invitation_email_sent",
      "moderate_rating",
      "process_tenant_data_deletion_request",
      "publish_menu_version",
      "purge_expired_analytics_events",
      "record_audit_event",
      "record_integration_sync_job",
      "require_tenant_permission",
      "run_menu_publish_checks",
      "set_dish_availability",
      "set_dish_variant_availability",
      "set_option_availability",
      "swap_category_sort_order",
      "transition_order_status",
    ];
    const SERVICE_ROLE_ONLY = [
      "mark_order_received_and_paid",
      "finalize_refund",
      "create_order_from_cart",
      "claim_payment_webhook_event",
      "apply_connect_account_snapshot",
      "reserve_auth_rate_limit_attempt",
      "mark_auth_rate_limit_attempt_succeeded",
      "record_failed_login_audit_event",
      "clone_menu_version_as_draft",
      "get_or_create_cart",
      "build_cart_view",
      "get_cart_view",
      "add_cart_item",
      "update_cart_item_quantity",
      "remove_cart_item",
      "get_order_status_by_token",
      "compute_period_order_stats",
      "submit_order_rating",
      "get_tenant_rating_summary",
      "sweep_stale_awaiting_payment_orders",
      "purge_stale_menu_view_attempts",
      "purge_stale_dish_engagement_attempts",
      "purge_expired_sales_import_batches",
      "record_menu_view",
      "record_dish_view",
      "record_dish_views",
      "record_add_to_cart_event",
    ];

    async function executableBy(role: string): Promise<string[]> {
      const res = await admin.query<{ proname: string }>(
        `select distinct p.proname
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.prokind = 'f'
            and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
            and has_function_privilege($1, p.oid, 'execute')
          order by 1`,
        [role],
      );
      return res.rows.map((r) => r.proname);
    }

    it("anon may execute only the public guest RPCs", async () => {
      expect(await executableBy("anon")).toEqual(ANON_ALLOW);
    });

    it("authenticated may execute only its allow-list", async () => {
      const unexpected = (await executableBy("authenticated")).filter(
        (name) => !AUTHENTICATED_ALLOW.includes(name),
      );
      expect(unexpected).toEqual([]);
    });

    it("RPCs the app calls with the signed-in user session remain executable by authenticated", async () => {
      // Derived from the `.rpc(` call sites in apps/web that use the
      // user-session client (not the admin client).
      const userSessionRpcs = [
        "accept_invitation",
        "commit_sales_import_batch",
        "create_initial_draft_menu_version",
        "create_integration_account",
        "create_invitation",
        "create_tenant_with_owner",
        "export_tenant_data",
        "get_analytics_dashboard_summary",
        "get_dish_performance_stats",
        "get_extras_performance_stats",
        "get_tenant_order_payment_statuses",
        "get_trend_period_stats",
        "has_tenant_permission",
        "list_integration_accounts",
        "list_integration_sync_jobs",
        "list_tenant_ratings_for_moderation",
        "mark_invitation_email_sent",
        "moderate_rating",
        "process_tenant_data_deletion_request",
        "publish_menu_version",
        "purge_expired_analytics_events",
        "record_audit_event",
        "record_integration_sync_job",
        "require_tenant_permission",
        "run_menu_publish_checks",
        "set_dish_availability",
        "set_dish_variant_availability",
        "set_option_availability",
        "swap_category_sort_order",
        "transition_order_status",
      ];
      const executable = await executableBy("authenticated");
      const missing = userSessionRpcs.filter((name) => !executable.includes(name));
      expect(missing).toEqual([]);
    });

    it("service_role-only functions are not executable by anon or authenticated", async () => {
      const anon = await executableBy("anon");
      const authenticated = await executableBy("authenticated");
      for (const name of SERVICE_ROLE_ONLY) {
        expect(anon, `anon must not execute ${name}`).not.toContain(name);
        expect(authenticated, `authenticated must not execute ${name}`).not.toContain(name);
      }
    });
  });

  // ---- (8) one awaiting_payment order per cart --------------------------
  describe("orders_one_active_per_cart_idx", () => {
    async function cartWithItem(tenantId: string, dish: SeededDish): Promise<string> {
      const cart = await admin.query<{ get_or_create_cart: string }>(
        `select get_or_create_cart($1, $2) as get_or_create_cart`,
        [tenantId, sha256(randomUUID())],
      );
      const cartId = cart.rows[0]!.get_or_create_cart;
      await addItem(cartId, tenantId, dish);
      return cartId;
    }
    async function addItem(cartId: string, tenantId: string, dish: SeededDish) {
      await admin.query(`select add_cart_item($1, $2, $3, $4, 1, $5)`, [
        cartId,
        tenantId,
        dish.dishId,
        dish.variantId,
        [],
      ]);
    }
    async function checkout(cartId: string, tenantId: string): Promise<string> {
      const res = await admin.query<{ r: { orderId: string } }>(
        `select create_order_from_cart($1, $2, 'pickup', 'Max', null, null, '', $3) as r`,
        [cartId, tenantId, sha256(randomUUID())],
      );
      return res.rows[0]!.r.orderId;
    }

    it("allows a second order from the same cart once the first one is paid", async () => {
      const f = await seedFixture();
      const dish = await seedPublishedDish(admin, f.tenantA.tenantId);
      const cartId = await cartWithItem(f.tenantA.tenantId, dish);
      const firstOrderId = await checkout(cartId, f.tenantA.tenantId);

      await admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'received')`,
        [f.tenantA.tenantId, firstOrderId],
      );

      await addItem(cartId, f.tenantA.tenantId, dish);
      const secondOrderId = await checkout(cartId, f.tenantA.tenantId);
      expect(secondOrderId).not.toBe(firstOrderId);
    });

    it("rejects two simultaneous awaiting_payment orders for one cart", async () => {
      const f = await seedFixture();
      const dish = await seedPublishedDish(admin, f.tenantA.tenantId);
      const cartId = await cartWithItem(f.tenantA.tenantId, dish);
      await checkout(cartId, f.tenantA.tenantId);

      await expect(
        admin.query(
          `insert into orders (tenant_id, cart_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, status)
           values ($1, $2, $3, 'pickup', 'Zweit', 'EUR', 100, 'awaiting_payment')`,
          [f.tenantA.tenantId, cartId, sha256(randomUUID())],
        ),
      ).rejects.toThrow(/duplicate key value|unique/i);
    });
  });

  // ---- (9) build_cart_view order ----------------------------------------
  describe("build_cart_view", () => {
    it("returns lines in creation order", async () => {
      const f = await seedFixture();
      const first = await seedPublishedDish(admin, f.tenantA.tenantId, "Erstes", 1, [
        "Zweites",
        "Drittes",
      ]);
      const second = first.extra[0]!;
      const third = first.extra[1]!;
      const cart = await admin.query<{ get_or_create_cart: string }>(
        `select get_or_create_cart($1, $2) as get_or_create_cart`,
        [f.tenantA.tenantId, sha256(randomUUID())],
      );
      const cartId = cart.rows[0]!.get_or_create_cart;
      // One statement (= one transaction, one created_at) per line.
      for (const dish of [first, second, third]) {
        await admin.query(`select add_cart_item($1, $2, $3, $4, 1, $5)`, [
          cartId,
          f.tenantA.tenantId,
          dish.dishId,
          dish.variantId,
          [],
        ]);
      }
      const view = await admin.query<{ v: { items: Array<{ dishId: string }> } }>(
        `select build_cart_view($1) as v`,
        [cartId],
      );
      expect(view.rows[0]!.v.items.map((i) => i.dishId)).toEqual([
        first.dishId,
        second.dishId,
        third.dishId,
      ]);
    });
  });

  // ---- (10) draft clone --------------------------------------------------
  describe("create_initial_draft_menu_version", () => {
    it("clones the published version instead of creating an empty draft", async () => {
      const f = await seedFixture();
      const published = await seedPublishedDish(admin, f.tenantA.tenantId);

      const res = await queryAsUser<{ id: string }>(
        admin,
        f.tenantA.ownerId,
        `select create_initial_draft_menu_version($1) as id`,
        [f.tenantA.tenantId],
      );
      const draftId = res.rows[0]!.id;
      expect(draftId).not.toBe(published.menuVersionId);
      const dishes = await admin.query(
        `select count(*)::int as n from dishes where menu_version_id = $1`,
        [draftId],
      );
      expect(dishes.rows[0].n).toBe(1);
    });

    it("replaces a completely empty draft by a clone, keeps a non-empty draft, and denies other tenants", async () => {
      const f = await seedFixture();
      await seedPublishedDish(admin, f.tenantA.tenantId);
      const emptyDraft = randomUUID();
      await admin.query(
        `insert into menu_versions (id, tenant_id, status, version_number) values ($1, $2, 'draft', 99)`,
        [emptyDraft, f.tenantA.tenantId],
      );

      await expect(
        queryAsUser(admin, f.tenantB.ownerId, `select create_initial_draft_menu_version($1)`, [
          f.tenantA.tenantId,
        ]),
      ).rejects.toThrow(/permission|insufficient/i);

      const res = await queryAsUser<{ id: string }>(
        admin,
        f.tenantA.ownerId,
        `select create_initial_draft_menu_version($1) as id`,
        [f.tenantA.tenantId],
      );
      const newDraft = res.rows[0]!.id;
      expect(newDraft).not.toBe(emptyDraft);
      const gone = await admin.query(`select 1 from menu_versions where id = $1`, [emptyDraft]);
      expect(gone.rows).toHaveLength(0);

      // The clone has content now, so a second call returns it unchanged.
      const again = await queryAsUser<{ id: string }>(
        admin,
        f.tenantA.ownerId,
        `select create_initial_draft_menu_version($1) as id`,
        [f.tenantA.tenantId],
      );
      expect(again.rows[0]!.id).toBe(newDraft);
    });
  });

  // ---- (11) indexes ------------------------------------------------------
  it("creates the foreign key and listing indexes", async () => {
    const res = await admin.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
      [
        [
          "dishes_category_id_idx",
          "dishes_menu_version_id_idx",
          "dishes_media_asset_id_idx",
          "dish_variants_dish_id_idx",
          "options_option_group_id_idx",
          "orders_tenant_id_created_at_idx",
        ],
      ],
    );
    expect(res.rows).toHaveLength(6);
  });
});

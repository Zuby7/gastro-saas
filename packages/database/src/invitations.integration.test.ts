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
      `[invitations.integration.test] CI or SUPABASE_DB_URL is set, but no reachable Postgres ` +
        `was found at ${DB_URL}. Refusing to silently skip invitation flow tests.`,
    );
  }

  console.warn(`[invitations.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

describe.skipIf(!dbAvailable)("invitations", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    await fixture?.cleanup();
    if (extraUserIds.length > 0) {
      await admin.query(`delete from auth.users where id = any($1::uuid[])`, [extraUserIds]);
      extraUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await admin.end();
  });

  async function invitedUser(email: string) {
    const id = randomUUID();
    extraUserIds.push(id);
    await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    return id;
  }

  async function roleId(tenantId: string, key = "service") {
    const role = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = $2`,
      [tenantId, key],
    );
    return role.rows[0]!.id;
  }

  it("creates and accepts a single-use tenant-scoped invitation", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const email = `invitee-${randomUUID()}@example.test`;
    const userId = await invitedUser(email);
    const tokenHash = "a".repeat(64);

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
      [tenantA.tenantId, email, await roleId(tenantA.tenantId), tokenHash],
    );

    const accepted = await queryAsUser<{ accept_invitation: string }>(
      admin,
      userId,
      `select accept_invitation($1)`,
      [tokenHash],
    );
    expect(accepted.rows[0]?.accept_invitation).toBe(tenantA.tenantId);

    const membership = await admin.query(
      `select tm.role
         from tenant_memberships tm
         join membership_roles mr on mr.membership_id = tm.id
         join roles r on r.id = mr.role_id
        where tm.tenant_id = $1
          and tm.user_id = $2
          and r.key = 'service'`,
      [tenantA.tenantId, userId],
    );
    expect(membership.rows[0]?.role).toBe("staff");

    await expect(
      queryAsUser(admin, userId, `select accept_invitation($1)`, [tokenHash]),
    ).rejects.toThrow(/already been used/i);
  });

  // Regression test for the Opus batch review (epic-3-5-batch, high,
  // privilege escalation): create_invitation() previously only checked
  // users.invite and left p_role_id unvalidated -- a Manager (users.invite +
  // users.manage, but no roles.manage) could invite someone directly as
  // Owner. This is now rejected unless the inviter holds roles.manage.
  it("rejects inviting as Owner without roles.manage", async () => {
    const managerUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: managerUserId, email: "manager-inviter@example.test", role: "manager" },
        ],
      },
    });
    const { tenantA } = fixture;
    const tokenHash = "c".repeat(64);

    await expect(
      queryAsUser(
        admin,
        managerUserId,
        `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
        [
          tenantA.tenantId,
          `owner-invitee-${randomUUID()}@example.test`,
          await roleId(tenantA.tenantId, "owner"),
          tokenHash,
        ],
      ),
    ).rejects.toThrow(/roles\.manage/i);

    const created = await admin.query(`select 1 from invitations where token_hash = $1`, [
      tokenHash,
    ]);
    expect(created.rows).toHaveLength(0);
  });

  // Regression tests for ticket #71 (Opus batch review, epic-3-5-batch,
  // cycle 2): the invitation email must be sent AFTER create_invitation()
  // persists the row, and mark_invitation_email_sent() confirms that send --
  // gated on users.invite for the invitation's own tenant, not callable by
  // an unrelated tenant's member.
  it("marks an invitation's email as sent when the caller holds users.invite for its tenant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const email = `pending-${randomUUID()}@example.test`;
    const tokenHash = "d".repeat(64);

    const created = await queryAsUser<{ create_invitation: string }>(
      admin,
      tenantA.ownerId,
      `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
      [tenantA.tenantId, email, await roleId(tenantA.tenantId), tokenHash],
    );
    const invitationId = created.rows[0]!.create_invitation;

    const beforeConfirm = await admin.query<{ email_sent_at: string | null }>(
      `select email_sent_at from invitations where id = $1`,
      [invitationId],
    );
    expect(beforeConfirm.rows[0]?.email_sent_at).toBeNull();

    await queryAsUser(admin, tenantA.ownerId, `select mark_invitation_email_sent($1)`, [
      invitationId,
    ]);

    const afterConfirm = await admin.query<{ email_sent_at: string | null }>(
      `select email_sent_at from invitations where id = $1`,
      [invitationId],
    );
    expect(afterConfirm.rows[0]?.email_sent_at).not.toBeNull();
  });

  it("rejects mark_invitation_email_sent from a different tenant's member", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const tokenHash = "e".repeat(64);

    const created = await queryAsUser<{ create_invitation: string }>(
      admin,
      tenantA.ownerId,
      `select create_invitation($1, $2, $3, $4, now() + interval '7 days')`,
      [
        tenantA.tenantId,
        `cross-tenant-${randomUUID()}@example.test`,
        await roleId(tenantA.tenantId),
        tokenHash,
      ],
    );
    const invitationId = created.rows[0]!.create_invitation;

    await expect(
      queryAsUser(admin, tenantB.ownerId, `select mark_invitation_email_sent($1)`, [invitationId]),
    ).rejects.toThrow(/insufficient_privilege|permission|Missing permission/i);
  });

  it("rejects expired invitations without creating a membership", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const email = `expired-${randomUUID()}@example.test`;
    const userId = await invitedUser(email);
    const tokenHash = "b".repeat(64);

    await admin.query(
      `insert into invitations (tenant_id, email, role_id, token_hash, expires_at, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', $5)`,
      [tenantA.tenantId, email, await roleId(tenantA.tenantId), tokenHash, tenantA.ownerId],
    );

    await expect(
      queryAsUser(admin, userId, `select accept_invitation($1)`, [tokenHash]),
    ).rejects.toThrow(/expired/i);

    const membership = await admin.query(
      `select 1 from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, userId],
    );
    expect(membership.rows).toHaveLength(0);
  });
});

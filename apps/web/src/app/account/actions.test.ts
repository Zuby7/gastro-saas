import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromSelectMock = vi.fn();
const sendInvitationEmailMock = vi.fn();
const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock, signOut: vi.fn() },
    from: fromSelectMock,
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({
    reserveAttempt: reserveAttemptMock,
    markSucceeded: markSucceededMock,
  }),
}));

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: async () => "203.0.113.30",
}));

vi.mock("@/lib/invitations/email", () => ({
  sendInvitationEmail: (...args: unknown[]) => sendInvitationEmailMock(...args),
}));

vi.mock("@/lib/invitations/tokens", () => ({
  createInvitationToken: () => "raw-token",
  hashInvitationToken: () => "a".repeat(64),
}));

function membershipQueryBuilder(result: {
  data: { tenant_id: string; tenants: { name: string } | null } | null;
  error: unknown;
}) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  };
}

function inviteFormData(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("email", overrides.email ?? "invitee@example.com");
  fd.set("roleId", overrides.roleId ?? "11111111-1111-4111-8111-111111111111");
  return fd;
}

function notLimitedReservation() {
  return { attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 };
}

function limitedReservation() {
  return { attemptId: "attempt-6", ipCount: 6, ipEmailCount: 6 };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromSelectMock.mockReturnValue(
    membershipQueryBuilder({
      data: { tenant_id: "tenant-1", tenants: { name: "Mario" } },
      error: null,
    }),
  );
  reserveAttemptMock.mockResolvedValue(notLimitedReservation());
});

describe("inviteMemberAction", () => {
  // Opus batch review (epic-3-5-batch, high, regression): a permission-less
  // tenant member must never trigger the invitation email at all -- the
  // users.invite check has to run and fail *before* anything else
  // (rate-limiting, persisting, or emailing).
  it("does not send an invitation email when the caller lacks users.invite", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(sendInvitationEmailMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalledWith("create_invitation", expect.anything());
    expect(reserveAttemptMock).not.toHaveBeenCalled();
  });

  // Ticket #71: rate-limits invitation sending, blocking before anything is
  // persisted or emailed.
  it("blocks the 6th invitation attempt for the same email within the window without persisting or emailing", async () => {
    reserveAttemptMock.mockResolvedValue(limitedReservation());
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(result.error).toContain("Zu viele Einladungen");
    expect(sendInvitationEmailMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalledWith("create_invitation", expect.anything());
  });

  // Ticket #71 fix (Opus batch review, epic-3-5-batch, cycle 2): the
  // invitation must be persisted (create_invitation, which writes the
  // audit_logs entry) BEFORE the email is sent, not after -- so a failed
  // persist can never follow an already-sent, unusable link, and every
  // attempt that passes the permission + rate-limit checks is audit-logged
  // regardless of whether the subsequent email send succeeds.
  it("persists the invitation before sending the email, then confirms the send", async () => {
    const callOrder: string[] = [];
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      if (fn === "create_invitation") {
        callOrder.push("create_invitation");
        return { data: "invitation-1", error: null };
      }
      if (fn === "mark_invitation_email_sent") {
        callOrder.push("mark_invitation_email_sent");
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });
    sendInvitationEmailMock.mockImplementation(async () => {
      callOrder.push("sendInvitationEmail");
    });

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(callOrder).toEqual([
      "create_invitation",
      "sendInvitationEmail",
      "mark_invitation_email_sent",
    ]);
    expect(rpcMock).toHaveBeenCalledWith(
      "mark_invitation_email_sent",
      expect.objectContaining({ p_invitation_id: "invitation-1" }),
    );
    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
    expect(result.success).toBeDefined();
  });

  // Ticket #71: if the email send fails AFTER a successful persist, the
  // already-created invitation is left in place (not deleted) -- the
  // caller just sees an error and audit_logs already has the entry.
  it("reports an error but does not crash when the email send fails after a successful persist", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      if (fn === "create_invitation") {
        return { data: "invitation-1", error: null };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });
    sendInvitationEmailMock.mockRejectedValue(new Error("SMTP down"));

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(result.error).toContain("gespeichert");
    expect(result.error).toContain("nicht versendet");
    expect(rpcMock).not.toHaveBeenCalledWith("mark_invitation_email_sent", expect.anything());
    expect(markSucceededMock).not.toHaveBeenCalled();
  });

  // Opus review finding on PR #106: mark_invitation_email_sent()'s
  // error/result was previously discarded entirely -- the caller was told
  // "created and sent" while email_sent_at silently stayed null with no
  // record of the discrepancy. Now logged loudly (console.error), matching
  // the finalize_refund() logging pattern.
  it("logs loudly (console.error) when mark_invitation_email_sent fails after a successful send, without failing the action", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      if (fn === "create_invitation") {
        return { data: "invitation-1", error: null };
      }
      if (fn === "mark_invitation_email_sent") {
        return { data: null, error: { message: "connection reset" } };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });
    sendInvitationEmailMock.mockResolvedValue(undefined);

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("mark_invitation_email_sent"),
      expect.objectContaining({ invitationId: "invitation-1" }),
    );
    // The email genuinely was sent -- this is a bookkeeping failure only,
    // not a reason to tell the caller the whole action failed.
    expect(result.success).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("reports an error when the persist itself fails, without ever emailing", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      if (fn === "create_invitation") {
        return { data: null, error: { message: "db error" } };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(result.error).toContain("konnte nicht gespeichert werden");
    expect(sendInvitationEmailMock).not.toHaveBeenCalled();
  });
});

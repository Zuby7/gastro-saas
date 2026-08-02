import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromSelectMock = vi.fn();
const sendInvitationEmailMock = vi.fn();
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

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromSelectMock.mockReturnValue(
    membershipQueryBuilder({
      data: { tenant_id: "tenant-1", tenants: { name: "Mario" } },
      error: null,
    }),
  );
});

describe("inviteMemberAction", () => {
  // Opus batch review (epic-3-5-batch, high, regression): a permission-less
  // tenant member must never trigger the invitation email at all -- the
  // users.invite check has to run and fail *before* sendInvitationEmail is
  // called, not only inside the create_invitation() RPC afterwards.
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
  });

  it("sends the invitation email and persists it when the caller has users.invite", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: null };
      }
      if (fn === "create_invitation") {
        return { data: "invitation-1", error: null };
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });
    sendInvitationEmailMock.mockResolvedValue(undefined);

    const { inviteMemberAction } = await import("./actions");
    const result = await inviteMemberAction({}, inviteFormData());

    expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_invitation", expect.any(Object));
    expect(result.success).toBeDefined();
  });
});

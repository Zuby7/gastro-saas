import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
}));

function formData(): FormData {
  const fd = new FormData();
  fd.set("token", "raw-token");
  return fd;
}

describe("acceptInvitationAction", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    rpcMock.mockReset();
    redirectMock.mockClear();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("shows a dedicated message when the account already belongs to a tenant", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "This account already belongs to a tenant" },
    });
    const { acceptInvitationAction } = await import("./actions");

    const result = await acceptInvitationAction({}, formData());

    expect(result.error).toBe(
      "Dieses Konto gehört bereits zu einem Restaurant. Bitte melden Sie sich mit einer anderen E-Mail-Adresse an.",
    );
  });

  it("still reports a used invitation as already used", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Invitation link has already been used." },
    });
    const { acceptInvitationAction } = await import("./actions");

    const result = await acceptInvitationAction({}, formData());

    expect(result.error).toBe("Diese Einladung wurde bereits verwendet.");
  });

  it("reports an expired invitation", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Invitation link has expired." } });
    const { acceptInvitationAction } = await import("./actions");

    const result = await acceptInvitationAction({}, formData());

    expect(result.error).toBe("Diese Einladung ist abgelaufen.");
  });
});

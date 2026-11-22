import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const getCurrentMembershipMock = vi.fn();
const supabase = { auth: { getUser: (...args: unknown[]) => getUserMock(...args) } };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => supabase,
}));
vi.mock("@/lib/tenant/current-membership", () => ({
  getCurrentMembership: (...args: unknown[]) => getCurrentMembershipMock(...args),
}));

import { getAccountContext } from "./account-context";

describe("getAccountContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no user and no membership (and skips the membership lookup) when signed out", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const context = await getAccountContext();

    expect(context).toEqual({ supabase, user: null, membership: null });
    expect(getCurrentMembershipMock).not.toHaveBeenCalled();
  });

  it("resolves the membership from the validated user's own id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    getCurrentMembershipMock.mockResolvedValue({ tenantId: "tenant-1", role: "owner" });

    const context = await getAccountContext();

    expect(getCurrentMembershipMock).toHaveBeenCalledWith(supabase, "user-1");
    expect(context.membership).toEqual({ tenantId: "tenant-1", role: "owner" });
  });

  it("returns a null membership for a user without one", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-2" } } });
    getCurrentMembershipMock.mockResolvedValue(null);

    expect((await getAccountContext()).membership).toBeNull();
  });
});

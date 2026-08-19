import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function membershipTable(
  data: { tenant_id: string; role: string } | null = {
    tenant_id: "tenant-1",
    role: "owner",
  },
) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") return membershipTable();
    throw new Error(`unexpected table: ${table}`);
  });
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "require_tenant_permission") return { data: null, error: null };
    if (fn === "moderate_rating") {
      return { data: { ratingId: "rating-1", status: "released" }, error: null };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });
});

describe("moderateRatingAction", () => {
  it("returns an error when the caller is not authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { moderateRatingAction } = await import("./actions");
    const result = await moderateRatingAction("rating-1", "released");

    expect(result.error).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalledWith("moderate_rating", expect.anything());
  });

  it("returns an error when the caller has no tenant membership", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable(null);
      throw new Error(`unexpected table: ${table}`);
    });

    const { moderateRatingAction } = await import("./actions");
    const result = await moderateRatingAction("rating-1", "released");

    expect(result.error).toBeDefined();
  });

  // Permission-boundary denied case (`.claude/rules/testing.md`: "any change
  // to a permission boundary needs a test for the denied case").
  it("denies a caller without reviews.moderate, never calling the moderate_rating RPC", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { moderateRatingAction } = await import("./actions");
    const result = await moderateRatingAction("rating-1", "released");

    expect(result.error).toBeDefined();
    expect(result.status).toBeUndefined();
  });

  it("re-derives the tenant id from the caller's own session, ignoring any client-supplied value", async () => {
    let requestedTenantId: string | undefined;
    rpcMock.mockImplementation(async (fn: string, args: { p_tenant_id?: string }) => {
      if (fn === "require_tenant_permission") {
        requestedTenantId = args.p_tenant_id;
        return { data: null, error: null };
      }
      if (fn === "moderate_rating") {
        return { data: { ratingId: "rating-1", status: "released" }, error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { moderateRatingAction } = await import("./actions");
    await moderateRatingAction("rating-1", "released");

    expect(requestedTenantId).toBe("tenant-1");
  });

  it("succeeds and returns the new status for an authorized caller", async () => {
    const { moderateRatingAction } = await import("./actions");
    const result = await moderateRatingAction("rating-1", "released");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("released");
  });

  it("maps a 'rating not found' RPC error to a safe, translated message", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "moderate_rating") {
        return { data: null, error: { message: "Rating not found" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { moderateRatingAction } = await import("./actions");
    const result = await moderateRatingAction("rating-1", "released");

    expect(result.error).toBe("Diese Bewertung wurde nicht gefunden.");
  });
});

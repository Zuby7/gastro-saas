import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const getClientIpMock = vi.fn();
const readMenuViewTokenMock = vi.fn();
const rpcMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: () => getClientIpMock(),
}));

vi.mock("./cookie", () => ({
  readMenuViewToken: (slug: string) => readMenuViewTokenMock(slug),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("recordMenuViewOnce", () => {
  it(
    "gives each distinct session its own rate-limit bucket when the client IP " +
      "can't be resolved, instead of collapsing all such visitors into one " +
      "shared 'unknown' bucket (Opus finding, PR #129)",
    async () => {
      getClientIpMock.mockResolvedValue("unknown");
      rpcMock.mockClear();

      const { recordMenuViewOnce } = await import("./service");

      const sessionCount = 100;
      for (let i = 0; i < sessionCount; i += 1) {
        readMenuViewTokenMock.mockResolvedValue(`session-token-${i}`);
        await recordMenuViewOnce("some-tenant", "11111111-1111-1111-1111-111111111111");
      }

      expect(rpcMock).toHaveBeenCalledTimes(sessionCount);

      const ipHashesUsed = new Set(
        rpcMock.mock.calls.map(([, params]) => (params as { p_ip_hash: string }).p_ip_hash),
      );

      // Each of the 100 distinct sessions must get its own bucket key -- if
      // the old bug were still present, every call would share the single
      // hash("unknown") bucket, and this set would have size 1 instead of
      // 100, capping the tenant at 30 events total regardless of how many
      // distinct visitors showed up.
      expect(ipHashesUsed.size).toBe(sessionCount);
      expect(ipHashesUsed.has(hash("unknown"))).toBe(false);
    },
  );

  it("hashes the real client IP directly when one is resolved", async () => {
    getClientIpMock.mockResolvedValue("203.0.113.42");
    readMenuViewTokenMock.mockResolvedValue("some-session-token");
    rpcMock.mockClear();

    const { recordMenuViewOnce } = await import("./service");
    await recordMenuViewOnce("some-tenant", "11111111-1111-1111-1111-111111111111");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, params] = rpcMock.mock.calls[0]!;
    expect((params as { p_ip_hash: string }).p_ip_hash).toBe(hash("203.0.113.42"));
  });
});

describe("recordDishViewsOnce", () => {
  it(
    "calls record_dish_views exactly once with every dish id, instead of once per dish " +
      "(PR #136 Opus finding: one call per dish previously took one advisory lock per " +
      "dish, serializing in Postgres)",
    async () => {
      getClientIpMock.mockResolvedValue("203.0.113.60");
      readMenuViewTokenMock.mockResolvedValue("some-session-token");
      rpcMock.mockClear();

      const { recordDishViewsOnce } = await import("./service");
      const dishIds = ["dish-1", "dish-2", "dish-3"];
      await recordDishViewsOnce("some-tenant", "11111111-1111-1111-1111-111111111111", dishIds);

      expect(rpcMock).toHaveBeenCalledTimes(1);
      const [rpcName, params] = rpcMock.mock.calls[0]!;
      expect(rpcName).toBe("record_dish_views");
      expect((params as { p_dish_ids: string[] }).p_dish_ids).toEqual(dishIds);
    },
  );

  it("does not call the RPC at all for an empty dish id list", async () => {
    rpcMock.mockClear();
    readMenuViewTokenMock.mockClear();

    const { recordDishViewsOnce } = await import("./service");
    await recordDishViewsOnce("some-tenant", "11111111-1111-1111-1111-111111111111", []);

    expect(rpcMock).not.toHaveBeenCalled();
    expect(readMenuViewTokenMock).not.toHaveBeenCalled();
  });
});

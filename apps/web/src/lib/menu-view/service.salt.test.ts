import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const TENANT = "11111111-1111-1111-1111-111111111111";
const DISH = "22222222-2222-2222-2222-222222222222";

describe("IP hash salting (#164)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses HMAC-SHA256 keyed with IP_HASH_SECRET when set", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-secret");
    getClientIpMock.mockResolvedValue("203.0.113.42");
    readMenuViewTokenMock.mockResolvedValue("some-session-token");
    rpcMock.mockClear();

    const { recordMenuViewOnce } = await import("./service");
    await recordMenuViewOnce("some-tenant", TENANT);

    const [, params] = rpcMock.mock.calls[0]!;
    const expected = createHmac("sha256", "test-secret").update("203.0.113.42").digest("hex");
    const plain = createHash("sha256").update("203.0.113.42").digest("hex");
    expect((params as { p_ip_hash: string }).p_ip_hash).toBe(expected);
    expect(expected).not.toBe(plain);
  });

  it("in production without IP_HASH_SECRET skips recording instead of storing an unsalted hash", async () => {
    vi.stubEnv("IP_HASH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getClientIpMock.mockResolvedValue("203.0.113.42");
    readMenuViewTokenMock.mockResolvedValue("some-session-token");
    rpcMock.mockClear();

    vi.resetModules();
    const svc = await import("./service");
    await svc.recordMenuViewOnce("some-tenant", TENANT);
    await svc.recordDishViewOnce("some-tenant", TENANT, DISH);
    await svc.recordDishViewsOnce("some-tenant", TENANT, [DISH]);
    await svc.recordAddToCartEventOnce("some-tenant", TENANT, DISH);

    expect(rpcMock).not.toHaveBeenCalled();
    // Warns only once per isolate, not on every request.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to plain SHA-256 outside production when the secret is unset", async () => {
    vi.stubEnv("IP_HASH_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    getClientIpMock.mockResolvedValue("203.0.113.42");
    readMenuViewTokenMock.mockResolvedValue("some-session-token");
    rpcMock.mockClear();

    vi.resetModules();
    const { recordAddToCartEventOnce } = await import("./service");
    await recordAddToCartEventOnce("some-tenant", TENANT, DISH);

    const [, params] = rpcMock.mock.calls[0]!;
    expect((params as { p_ip_hash: string }).p_ip_hash).toBe(
      createHash("sha256").update("203.0.113.42").digest("hex"),
    );
  });
});

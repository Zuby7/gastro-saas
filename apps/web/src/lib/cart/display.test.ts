import { beforeEach, describe, expect, it, vi } from "vitest";

const readCartTokenMock = vi.fn();
const getCartViewMock = vi.fn();
const resolveTenantIdBySlugMock = vi.fn();
const maybeSingleMock = vi.fn();
const rpcMock = vi.fn();
const eqCalls: Array<[string, unknown]> = [];

vi.mock("@/lib/cart/cookie", () => ({
  readCartToken: (...args: unknown[]) => readCartTokenMock(...args),
}));
vi.mock("@/lib/cart/service", () => ({
  getCartView: (...args: unknown[]) => getCartViewMock(...args),
  resolveTenantIdBySlug: (...args: unknown[]) => resolveTenantIdBySlugMock(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    });
    builder.maybeSingle = maybeSingleMock;
    return { from: () => builder, rpc: rpcMock };
  },
}));

import { loadCartViewForDisplay } from "./display";

describe("loadCartViewForDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqCalls.length = 0;
    resolveTenantIdBySlugMock.mockResolvedValue("tenant-1");
  });

  it("returns null without touching the database when there is no cart cookie", async () => {
    readCartTokenMock.mockResolvedValue(null);
    expect(await loadCartViewForDisplay("demo")).toBeNull();
    expect(maybeSingleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("never creates a cart: returns null when no row matches the token", async () => {
    readCartTokenMock.mockResolvedValue("raw-token");
    maybeSingleMock.mockResolvedValue({ data: null });
    expect(await loadCartViewForDisplay("demo")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(getCartViewMock).not.toHaveBeenCalled();
  });

  it("looks up by tenant and hashed token and returns the cart view", async () => {
    readCartTokenMock.mockResolvedValue("raw-token");
    maybeSingleMock.mockResolvedValue({ data: { id: "cart-1" } });
    getCartViewMock.mockResolvedValue({ itemCount: 2 });
    expect(await loadCartViewForDisplay("demo")).toEqual({ itemCount: 2 });
    expect(eqCalls[0]).toEqual(["tenant_id", "tenant-1"]);
    expect(eqCalls[1]![0]).toBe("cart_token_hash");
    expect(eqCalls[1]![1]).toMatch(/^[a-f0-9]{64}$/);
    expect(getCartViewMock).toHaveBeenCalledWith("cart-1", "tenant-1");
  });

  it("reuses a known tenant id instead of resolving it again", async () => {
    readCartTokenMock.mockResolvedValue("raw-token");
    maybeSingleMock.mockResolvedValue({ data: null });
    await loadCartViewForDisplay("demo", "tenant-9");
    expect(resolveTenantIdBySlugMock).not.toHaveBeenCalled();
  });
});

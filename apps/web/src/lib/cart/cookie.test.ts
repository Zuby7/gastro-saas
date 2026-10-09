import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));

import { readCartToken, writeCartTokenCookie } from "./cookie";

describe("cart cookie", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.set.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes a per-slug httpOnly, sameSite=lax, 14-day cookie", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await writeCartTokenCookie("pizza-roma", "tok");
    expect(store.set).toHaveBeenCalledWith("gastro_cart_pizza-roma", "tok", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  });

  it("sets secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await writeCartTokenCookie("a", "tok");
    expect(store.set.mock.calls[0]?.[2]).toMatchObject({ secure: true });
  });

  it("strips unsafe characters from the slug in the cookie name", async () => {
    await writeCartTokenCookie("Ev;il/Slug", "tok");
    expect(store.set.mock.calls[0]?.[0]).toBe("gastro_cart_villug");
  });

  it("reads the token for the slug, or null", async () => {
    store.get.mockReturnValueOnce({ value: "abc" });
    expect(await readCartToken("pizza")).toBe("abc");
    expect(store.get).toHaveBeenCalledWith("gastro_cart_pizza");
    store.get.mockReturnValueOnce(undefined);
    expect(await readCartToken("pizza")).toBeNull();
  });
});

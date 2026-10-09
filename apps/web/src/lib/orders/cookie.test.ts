import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));

import { writeOrderAccessTokenCookie } from "./cookie";

describe("order access cookie", () => {
  beforeEach(() => {
    store.set.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes a per-slug httpOnly, sameSite=lax, 3-day cookie", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await writeOrderAccessTokenCookie("pizza-roma", "tok");
    expect(store.set).toHaveBeenCalledWith("gastro_order_pizza-roma", "tok", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 3,
    });
  });

  it("sets secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await writeOrderAccessTokenCookie("a", "tok");
    expect(store.set.mock.calls[0]?.[2]).toMatchObject({ secure: true });
  });

  it("strips unsafe characters from the slug in the cookie name", async () => {
    await writeOrderAccessTokenCookie("Ev;il/Slug", "tok");
    expect(store.set.mock.calls[0]?.[0]).toBe("gastro_order_villug");
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeConsent } from "@/lib/consent/cookie";

type SetAll = (
  cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
) => void;

let refreshedCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> =
  [];
const getUserMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  refreshedCookies = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  getUserMock.mockImplementation(async () => {
    // Mirrors @supabase/ssr: a token refresh inside getUser() calls setAll.
    const options = createServerClientMock.mock.calls.at(-1)![2] as { cookies: { setAll: SetAll } };
    if (refreshedCookies.length > 0) {
      options.cookies.setAll(refreshedCookies);
    }
    return { data: { user: null }, error: null };
  });
  createServerClientMock.mockImplementation(() => ({ auth: { getUser: getUserMock } }));
});

describe("middleware Supabase session refresh", () => {
  it("creates the client from the public env vars and validates the user via getUser()", async () => {
    const { middleware } = await import("./middleware");
    await middleware(new NextRequest("http://localhost/account"));

    expect(createServerClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("exposes the incoming request cookies to the Supabase client", async () => {
    const { middleware } = await import("./middleware");
    await middleware(
      new NextRequest("http://localhost/account", { headers: { cookie: "sb-token=abc" } }),
    );

    const options = createServerClientMock.mock.calls[0]![2] as {
      cookies: { getAll: () => Array<{ name: string; value: string }> };
    };
    expect(options.cookies.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);
  });

  it("writes refreshed session cookies onto both the request and the response", async () => {
    refreshedCookies = [
      { name: "sb-token", value: "rotated", options: { httpOnly: true, path: "/" } },
    ];
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/account", {
      headers: { cookie: "sb-token=old" },
    });

    const response = await middleware(request);

    expect(request.cookies.get("sb-token")?.value).toBe("rotated");
    const cookie = response.cookies.get("sb-token");
    expect(cookie?.value).toBe("rotated");
    expect(cookie?.httpOnly).toBe(true);
  });

  it("keeps refreshed session cookies when it also mints the menu-view cookie", async () => {
    refreshedCookies = [{ name: "sb-token", value: "rotated", options: { path: "/" } }];
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo", {
      headers: { cookie: `gastro_cookie_consent=${serializeConsent(true, new Date())}` },
    });

    const response = await middleware(request);

    expect(response.cookies.get("sb-token")?.value).toBe("rotated");
    const view = response.cookies.get("gastro_view_demo");
    expect(view?.value).toBeTruthy();
    expect(view?.httpOnly).toBe(true);
    expect(view?.sameSite).toBe("lax");
    expect(view?.maxAge).toBe(60 * 60 * 24);
  });

  it("does not re-mint a menu-view cookie that already exists", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo", {
      headers: {
        cookie: `gastro_cookie_consent=${serializeConsent(true, new Date())}; gastro_view_demo=existing`,
      },
    });

    const response = await middleware(request);

    expect(response.cookies.get("gastro_view_demo")).toBeUndefined();
  });

  it("keeps refreshed session cookies while clearing a menu-view cookie without consent", async () => {
    refreshedCookies = [{ name: "sb-token", value: "rotated", options: { path: "/" } }];
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo/cart", {
      headers: { cookie: "gastro_view_demo=old; gastro_view_other=old2; unrelated=keep" },
    });

    const response = await middleware(request);

    expect(response.cookies.get("sb-token")?.value).toBe("rotated");
    expect(response.cookies.get("gastro_view_demo")?.value).toBe("");
    expect(response.cookies.get("gastro_view_other")?.value).toBe("");
    expect(response.cookies.get("unrelated")).toBeUndefined();
    expect(request.cookies.get("unrelated")?.value).toBe("keep");
  });

  it("only mints the menu-view cookie on the base public menu route, not on sub-routes", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo/cart", {
      headers: { cookie: `gastro_cookie_consent=${serializeConsent(true, new Date())}` },
    });

    const response = await middleware(request);

    expect(response.cookies.get("gastro_view_demo")).toBeUndefined();
  });
});

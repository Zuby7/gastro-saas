import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

/**
 * Ticket #146: the `menu_view` analytics cookie (ticket #67) is
 * non-essential and must only be minted once the visitor has explicitly
 * accepted the cookie-consent banner.
 */
describe("middleware menu-view cookie consent gate", () => {
  it("does not mint the menu-view cookie when no consent decision has been made yet", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo");

    const response = await middleware(request);

    const setCookies = response.cookies.getAll();
    expect(setCookies.some((cookie) => cookie.name.startsWith("gastro_view_"))).toBe(false);
  });

  it("does not mint the menu-view cookie when consent was declined", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo", {
      headers: { cookie: "gastro_cookie_consent=declined" },
    });

    const response = await middleware(request);

    const setCookies = response.cookies.getAll();
    expect(setCookies.some((cookie) => cookie.name.startsWith("gastro_view_"))).toBe(false);
  });

  it("mints the menu-view cookie once consent has been accepted", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo", {
      headers: { cookie: "gastro_cookie_consent=accepted" },
    });

    const response = await middleware(request);

    const setCookies = response.cookies.getAll();
    expect(setCookies.some((cookie) => cookie.name === "gastro_view_demo")).toBe(true);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_VALIDITY_SECONDS, serializeConsent } from "@/lib/consent/cookie";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

function consent(statistics: boolean, now: Date = new Date()): string {
  return serializeConsent(statistics, now);
}

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
      headers: { cookie: "gastro_cookie_consent=" + consent(false) + "" },
    });

    const response = await middleware(request);

    const setCookies = response.cookies.getAll();
    expect(setCookies.some((cookie) => cookie.name.startsWith("gastro_view_"))).toBe(false);
  });

  it("mints the menu-view cookie once consent has been accepted", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest("http://localhost/r/demo", {
      headers: { cookie: "gastro_cookie_consent=" + consent(true) + "" },
    });

    const response = await middleware(request);

    const setCookies = response.cookies.getAll();
    expect(setCookies.some((cookie) => cookie.name === "gastro_view_demo")).toBe(true);
  });

  it(
    "clears an already-minted menu-view cookie from a prior visit when consent is " +
      "declined (Opus repair-cycle finding: gating only the mint, not the cookie's " +
      "continued presence, would let a pre-existing cookie keep being counted for up " +
      "to its remaining lifetime after a decline)",
    async () => {
      const { middleware } = await import("./middleware");
      const request = new NextRequest("http://localhost/r/demo", {
        headers: {
          cookie: "gastro_cookie_consent=" + consent(false) + "; gastro_view_demo=old-token",
        },
      });

      const response = await middleware(request);

      const deletedCookie = response.cookies.get("gastro_view_demo");
      expect(deletedCookie?.value).toBe("");
    },
  );

  it(
    "also clears a leftover menu-view cookie when there is no consent decision at all " +
      "(e.g. minted by a pre-#146 deploy, before consent decisions existed)",
    async () => {
      const { middleware } = await import("./middleware");
      const request = new NextRequest("http://localhost/r/demo", {
        headers: { cookie: "gastro_view_demo=old-token" },
      });

      const response = await middleware(request);

      const deletedCookie = response.cookies.get("gastro_view_demo");
      expect(deletedCookie?.value).toBe("");
    },
  );

  it("treats legacy 'accepted'/'declined' values as no consent (no mint, existing cookie cleared)", async () => {
    const { middleware } = await import("./middleware");
    for (const legacy of ["accepted", "declined"]) {
      const response = await middleware(
        new NextRequest("http://localhost/r/demo", {
          headers: { cookie: `gastro_cookie_consent=${legacy}; gastro_view_demo=old` },
        }),
      );
      expect(response.cookies.get("gastro_view_demo")?.value).toBe("");
    }
    const mint = await middleware(
      new NextRequest("http://localhost/r/demo", {
        headers: { cookie: "gastro_cookie_consent=accepted" },
      }),
    );
    expect(mint.cookies.getAll().some((c) => c.name.startsWith("gastro_view_"))).toBe(false);
  });

  it("does not mint after the decision expired (older than 6 months)", async () => {
    const { middleware } = await import("./middleware");
    const old = new Date(Date.now() - (CONSENT_VALIDITY_SECONDS + 60) * 1000);
    const response = await middleware(
      new NextRequest("http://localhost/r/demo", {
        headers: { cookie: `gastro_cookie_consent=${consent(true, old)}` },
      }),
    );
    expect(response.cookies.getAll().some((c) => c.name.startsWith("gastro_view_"))).toBe(false);
  });

  it("withdrawal (statistics=false) clears menu_view on non-menu routes such as the cart", async () => {
    const { middleware } = await import("./middleware");
    const response = await middleware(
      new NextRequest("http://localhost/r/demo/cart", {
        headers: { cookie: `gastro_cookie_consent=${consent(false)}; gastro_view_demo=old` },
      }),
    );
    expect(response.cookies.get("gastro_view_demo")?.value).toBe("");
  });

  it("keeps an existing menu_view cookie while statistics consent is valid", async () => {
    const { middleware } = await import("./middleware");
    const response = await middleware(
      new NextRequest("http://localhost/r/demo/cart", {
        headers: { cookie: `gastro_cookie_consent=${consent(true)}; gastro_view_demo=keep` },
      }),
    );
    expect(response.cookies.get("gastro_view_demo")).toBeUndefined();
  });
});

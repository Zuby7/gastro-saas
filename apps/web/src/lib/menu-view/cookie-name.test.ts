import { describe, expect, it } from "vitest";
import { menuViewCookieName } from "./cookie-name";

describe("menuViewCookieName", () => {
  it("passes through an already-safe slug unchanged", () => {
    expect(menuViewCookieName("pizza-palace")).toBe("gastro_view_pizza-palace");
  });

  it("strips characters outside [a-z0-9-]", () => {
    expect(menuViewCookieName("Pizza_Palace!42")).toBe("gastro_view_izzaalace42");
  });

  it("produces the same cookie name for the same slug every time (middleware and cookie reader must agree)", () => {
    const slug = "sushi-bar-2";
    expect(menuViewCookieName(slug)).toBe(menuViewCookieName(slug));
  });
});

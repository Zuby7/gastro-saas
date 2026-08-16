import { describe, expect, it } from "vitest";
import { roleLabel } from "./role-labels";

describe("roleLabel", () => {
  it("translates every known system role key to its German label", () => {
    expect(roleLabel("owner")).toBe("Inhaber");
    expect(roleLabel("manager")).toBe("Geschäftsführung");
    expect(roleLabel("staff")).toBe("Mitarbeiter");
    expect(roleLabel("kitchen")).toBe("Küche");
    expect(roleLabel("service")).toBe("Service");
    expect(roleLabel("marketing")).toBe("Marketing");
  });

  it("falls back to the provided fallback name for an unrecognized key", () => {
    expect(roleLabel("sommelier", "Sommelier")).toBe("Sommelier");
  });

  it("falls back to the raw key when no fallback name is given", () => {
    expect(roleLabel("sommelier")).toBe("sommelier");
  });

  // Regression test: the lookup map must never resolve to an inherited
  // Object.prototype member (e.g. a role key of "constructor" or
  // "toString") -- that would return a function, not a string, which React
  // refuses to render as a child.
  it("never resolves a prototype-chain member for a key colliding with Object.prototype", () => {
    expect(roleLabel("constructor")).toBe("constructor");
    expect(roleLabel("toString", "Eigene Rolle")).toBe("Eigene Rolle");
    expect(roleLabel("hasOwnProperty")).toBe("hasOwnProperty");
  });
});

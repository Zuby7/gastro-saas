import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { menuViewCookieName } from "@/lib/menu-view/cookie-name";
import { CONSENT_COOKIE_NAME } from "./cookie";
import { COOKIE_INVENTORY } from "./inventory";

const SRC_ROOT = join(__dirname, "..", "..");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return listSourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function inventoryMatches(cookieName: string): boolean {
  return COOKIE_INVENTORY.some((entry) => {
    if (entry.name.endsWith("*")) {
      return cookieName.startsWith(entry.name.slice(0, -1));
    }
    const prefix = entry.name.replace("<slug>", "");
    return entry.name.includes("<slug>") ? cookieName.startsWith(prefix) : cookieName === prefix;
  });
}

describe("cookie inventory matches the code", () => {
  it("lists the consent and menu-view cookies produced by the code helpers", () => {
    expect(inventoryMatches(CONSENT_COOKIE_NAME)).toBe(true);
    expect(inventoryMatches(menuViewCookieName("demo"))).toBe(true);
  });

  it("every first-party cookie name literal (gastro_*) in production code is in the inventory", () => {
    const names = new Set<string>();
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/["'`](gastro_[a-z_]+?)(?:\$\{|["'`])/g)) {
        names.add(match[1]!);
      }
    }
    expect(names.size).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      // `gastro_cart_`/`gastro_order_`/`gastro_view_` are prefixes followed by the slug.
      expect(inventoryMatches(name), `${name} missing in COOKIE_INVENTORY`).toBe(true);
    }
  });

  it("only known modules write cookies (a new writer must update inventory, banner and Datenschutz)", () => {
    const writers: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, "utf8");
      if (/cookieStore\.set\(|response\.cookies\.set\(|document\.cookie\s*=/.test(text)) {
        writers.push(file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"));
      }
    }
    expect(writers.sort()).toEqual(
      [
        "app/r/[slug]/cookie-consent-banner.tsx",
        "lib/cart/cookie.ts",
        "lib/orders/cookie.ts",
        "lib/supabase/server.ts",
        "middleware.ts",
      ].sort(),
    );
  });

  it("every entry has name, purpose, duration, provider", () => {
    for (const entry of COOKIE_INVENTORY) {
      expect(entry.name && entry.purpose && entry.duration && entry.provider).toBeTruthy();
    }
    expect(COOKIE_INVENTORY.filter((e) => e.category === "statistics").map((e) => e.name)).toEqual([
      "gastro_view_<slug>",
    ]);
  });
});

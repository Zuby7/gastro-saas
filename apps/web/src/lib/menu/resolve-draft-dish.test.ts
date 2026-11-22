import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveDishVersionContext } from "./resolve-draft-dish";

/** Chainable query stub: every builder method returns itself, maybeSingle pops the next result. */
function clientWith(results: Record<string, unknown[]>) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, filters: [] as unknown[][] };
      calls.push(entry);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "limit"]) {
        chain[method] = (...args: unknown[]) => {
          entry.filters.push([method, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: results[table]?.shift() ?? null });
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const INPUT = {
  tenantId: "tenant-1",
  menuVersionId: "v-published",
  categoryId: "cat-old",
  dishName: "Margherita",
};

describe("resolveDishVersionContext", () => {
  it("treats a dish in a draft version as editable", async () => {
    const { client } = clientWith({ menu_versions: [{ id: "v-published", status: "draft" }] });
    expect(await resolveDishVersionContext(client, INPUT)).toEqual({ kind: "draft" });
  });

  it("resolves the matching dish in the current draft by category and dish name", async () => {
    const { client, calls } = clientWith({
      menu_versions: [{ id: "v-published", status: "published" }, { id: "v-draft" }],
      categories: [{ name: "Pizza" }, { id: "cat-new" }],
      dishes: [{ id: "dish-new" }],
    });

    expect(await resolveDishVersionContext(client, INPUT)).toEqual({
      kind: "frozen",
      draftDishId: "dish-new",
      draftExists: true,
    });
    // Every read stays tenant-scoped and ignores archived rows.
    for (const call of calls) {
      expect(call.filters).toContainEqual(["eq", "tenant_id", "tenant-1"]);
    }
    const dishCall = calls.find((call) => call.table === "dishes");
    expect(dishCall?.filters).toContainEqual(["is", "archived_at", null]);
    expect(dishCall?.filters).toContainEqual(["eq", "menu_version_id", "v-draft"]);
  });

  it("falls back to read-only when the dish has no twin in the draft", async () => {
    const { client } = clientWith({
      menu_versions: [{ id: "v-published", status: "published" }, { id: "v-draft" }],
      categories: [{ name: "Pizza" }, { id: "cat-new" }],
      dishes: [],
    });
    expect(await resolveDishVersionContext(client, INPUT)).toEqual({
      kind: "frozen",
      draftDishId: null,
      draftExists: true,
    });
  });

  it("falls back to read-only when the category is gone from the draft", async () => {
    const { client } = clientWith({
      menu_versions: [{ id: "v-published", status: "archived" }, { id: "v-draft" }],
      categories: [{ name: "Pizza" }],
    });
    expect(await resolveDishVersionContext(client, INPUT)).toMatchObject({
      kind: "frozen",
      draftDishId: null,
    });
  });

  it("reports a missing draft", async () => {
    const { client } = clientWith({
      menu_versions: [{ id: "v-published", status: "published" }],
    });
    expect(await resolveDishVersionContext(client, INPUT)).toEqual({
      kind: "frozen",
      draftDishId: null,
      draftExists: false,
    });
  });
});

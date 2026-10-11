import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Project style rule (user request 2026-10-11): no em dashes (U+2014) and no
 * en dashes (U+2013) anywhere in the repository's text files. Use a normal
 * hyphen, a comma, a colon or a rephrasing instead. This guard keeps the rule
 * from regressing, in code, docs, and UI copy alike.
 */
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".open-next",
  ".wrangler",
  "coverage",
  "worktrees",
]);
const TEXT_EXT = /\.(ts|tsx|md|mdx|json|sql|css|yml|yaml|html|txt|mjs|cjs|jsonc)$/;
const SKIP_FILES = new Set(["pnpm-lock.yaml"]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (TEXT_EXT.test(name) && !SKIP_FILES.has(name)) out.push(full);
  }
}

describe("typography guard", () => {
  it("contains no em dashes or en dashes in any text file", () => {
    const files: string[] = [];
    walk(REPO_ROOT, files);
    const offenders = files
      .filter((file) => new RegExp("[\\u2013\\u2014]").test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  }, 60_000);
});

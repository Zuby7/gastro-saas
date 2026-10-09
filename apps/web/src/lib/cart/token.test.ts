import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCartToken, hashCartToken } from "./token";

describe("cart token", () => {
  it("generates URL-safe, 256-bit base64url tokens", () => {
    const token = createCartToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates unique tokens", () => {
    expect(new Set(Array.from({ length: 200 }, () => createCartToken())).size).toBe(200);
  });

  it("hashes deterministically to a SHA-256 hex digest", () => {
    const hash = hashCartToken("abc");
    expect(hash).toBe(hashCartToken("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
  });

  it("hashes different inputs differently", () => {
    expect(hashCartToken("token-a")).not.toBe(hashCartToken("token-b"));
  });

  it("never equals the raw token", () => {
    const token = createCartToken();
    expect(hashCartToken(token)).not.toBe(token);
  });
});

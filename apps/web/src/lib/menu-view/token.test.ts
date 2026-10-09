import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMenuViewToken, hashMenuViewToken } from "./token";

describe("menu-view token", () => {
  it("generates URL-safe, 256-bit base64url tokens", () => {
    const token = createMenuViewToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates unique tokens", () => {
    expect(new Set(Array.from({ length: 200 }, () => createMenuViewToken())).size).toBe(200);
  });

  it("hashes deterministically to a SHA-256 hex digest", () => {
    const hash = hashMenuViewToken("abc");
    expect(hash).toBe(hashMenuViewToken("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
  });

  it("hashes different inputs differently", () => {
    expect(hashMenuViewToken("token-a")).not.toBe(hashMenuViewToken("token-b"));
  });

  it("never equals the raw token", () => {
    const token = createMenuViewToken();
    expect(hashMenuViewToken(token)).not.toBe(token);
  });
});

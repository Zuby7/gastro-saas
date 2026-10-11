import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOLLIE_STATE_TTL_SECONDS,
  createOAuthNonce,
  signMollieOAuthState,
  verifyMollieOAuthState,
} from "./oauth-state";

describe("mollie oauth state", () => {
  beforeEach(() => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const input = { tenantId: "tenant-1", userId: "user-1", nonce: "nonce-1" };

  it("verifies a freshly signed state and returns its binding", async () => {
    const state = await signMollieOAuthState(input);
    await expect(verifyMollieOAuthState(state)).resolves.toMatchObject(input);
  });

  it("rejects an expired state", async () => {
    const now = Date.now();
    const state = await signMollieOAuthState(input, now);
    await expect(
      verifyMollieOAuthState(state, now + (MOLLIE_STATE_TTL_SECONDS + 5) * 1000),
    ).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const state = await signMollieOAuthState(input);
    const [, signature] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...input, tenantId: "tenant-2", expiresAt: 9999999999 }),
    ).toString("base64url");
    await expect(verifyMollieOAuthState(`${forged}.${signature}`)).resolves.toBeNull();
  });

  it("rejects a state signed with another key", async () => {
    const state = await signMollieOAuthState(input);
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
    await expect(verifyMollieOAuthState(state)).resolves.toBeNull();
  });

  it("rejects garbage and empty input without throwing", async () => {
    await expect(verifyMollieOAuthState(null)).resolves.toBeNull();
    await expect(verifyMollieOAuthState("")).resolves.toBeNull();
    await expect(verifyMollieOAuthState("a.b.c")).resolves.toBeNull();
    await expect(verifyMollieOAuthState("not-a-state")).resolves.toBeNull();
  });

  it("generates distinct nonces", () => {
    expect(createOAuthNonce()).not.toBe(createOAuthNonce());
  });
});

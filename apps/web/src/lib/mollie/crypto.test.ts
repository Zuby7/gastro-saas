import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MollieCryptoError, decryptSecret, encryptSecret } from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("mollie token crypto", () => {
  beforeEach(() => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a secret", async () => {
    const encrypted = await encryptSecret("access_token_value", "tenant-1:mollie:access");
    expect(encrypted.ciphertext).not.toContain("access_token_value");
    await expect(decryptSecret(encrypted, "tenant-1:mollie:access")).resolves.toBe(
      "access_token_value",
    );
  });

  it("uses a fresh IV per encryption", async () => {
    const a = await encryptSecret("same", "aad");
    const b = await encryptSecret("same", "aad");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptSecret("secret", "aad");
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await expect(
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }, "aad"),
    ).rejects.toBeInstanceOf(MollieCryptoError);
  });

  it("rejects a different AAD (ciphertext moved to another tenant/column)", async () => {
    const encrypted = await encryptSecret("secret", "tenant-1:mollie:access");
    await expect(decryptSecret(encrypted, "tenant-2:mollie:access")).rejects.toBeInstanceOf(
      MollieCryptoError,
    );
  });

  it("rejects decryption with a different key", async () => {
    const encrypted = await encryptSecret("secret", "aad");
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 9).toString("base64"));
    await expect(decryptSecret(encrypted, "aad")).rejects.toBeInstanceOf(MollieCryptoError);
  });

  it("fails closed when the key is unset", async () => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", "");
    await expect(encryptSecret("x", "aad")).rejects.toThrow(/MOLLIE_TOKEN_KEY/);
    await expect(decryptSecret({ ciphertext: "AAAA", iv: "AAAA" }, "aad")).rejects.toThrow(
      /MOLLIE_TOKEN_KEY/,
    );
  });

  it("fails closed when the key has the wrong length", async () => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(16, 1).toString("base64"));
    await expect(encryptSecret("x", "aad")).rejects.toThrow(/32 bytes/);
  });

  it("fails closed when the key is not base64", async () => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", "%%%not-base64%%%");
    await expect(encryptSecret("x", "aad")).rejects.toBeInstanceOf(MollieCryptoError);
  });
});

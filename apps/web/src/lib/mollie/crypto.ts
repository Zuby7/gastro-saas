/**
 * Token encryption for Mollie OAuth tokens (issue #195, ADR-0004).
 *
 * AES-256-GCM via WebCrypto (`crypto.subtle`), which is available in Node and
 * in the Cloudflare Workers runtime -- no Node-only `crypto` APIs. The key is
 * `MOLLIE_TOKEN_KEY` (32 random bytes, base64). Fails CLOSED: with no key, a
 * malformed key or a wrong-length key, every operation throws -- tokens are
 * never stored or read in plaintext as a fallback.
 *
 * Each encryption uses a fresh random 96-bit IV. `aad` (additional
 * authenticated data, e.g. `${tenantId}:access`) is bound into the GCM tag, so
 * a ciphertext copied to another tenant's row or swapped between the access-
 * and refresh-token columns fails to decrypt.
 *
 * Never log plaintext, ciphertext, IVs or the key.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

export class MollieCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MollieCryptoError";
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new MollieCryptoError("Invalid base64 value.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Reads and validates `MOLLIE_TOKEN_KEY`; throws (fail closed) if unusable. */
export function getMollieTokenKeyBytes(): Uint8Array {
  const raw = process.env.MOLLIE_TOKEN_KEY;
  if (!raw) {
    throw new MollieCryptoError("MOLLIE_TOKEN_KEY must be set to store or read Mollie tokens.");
  }
  const bytes = base64ToBytes(raw.trim());
  if (bytes.length !== KEY_BYTES) {
    throw new MollieCryptoError("MOLLIE_TOKEN_KEY must decode to exactly 32 bytes.");
  }
  return bytes;
}

async function importAesKey(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const keyBytes = getMollieTokenKeyBytes();
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, [
    usage,
  ]);
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

export async function encryptSecret(plaintext: string, aad: string): Promise<EncryptedValue> {
  const key = await importAesKey("encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSecret(value: EncryptedValue, aad: string): Promise<string> {
  const key = await importAesKey("decrypt");
  const iv = base64ToBytes(value.iv);
  if (iv.length !== IV_BYTES) {
    throw new MollieCryptoError("Invalid IV.");
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) },
      key,
      base64ToBytes(value.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Deliberately generic: never reveal why (tamper / wrong key / wrong aad).
    throw new MollieCryptoError("Could not decrypt the stored value.");
  }
}

import { base64ToBytes, bytesToBase64, getMollieTokenKeyBytes } from "./crypto";

/**
 * Signed, expiring OAuth `state` for the Mollie connect flow (CSRF defense).
 * Bound to the tenant AND the user that started the flow; the callback
 * additionally requires a matching httpOnly nonce cookie and the same session
 * user/tenant. HMAC-SHA256 with a key derived from MOLLIE_TOKEN_KEY (domain
 * separated), constant-time verified through WebCrypto.
 */

export const MOLLIE_STATE_TTL_SECONDS = 10 * 60;

export interface MollieOAuthStatePayload {
  tenantId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

async function getSigningKey(usage: "sign" | "verify"): Promise<CryptoKey> {
  const master = await crypto.subtle.importKey(
    "raw",
    getMollieTokenKeyBytes() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    master,
    new TextEncoder().encode("gastro-saas:mollie-oauth-state:v1"),
  );
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export function createOAuthNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function signMollieOAuthState(
  input: { tenantId: string; userId: string; nonce: string },
  nowMs: number = Date.now(),
): Promise<string> {
  const payload: MollieOAuthStatePayload = {
    ...input,
    expiresAt: Math.floor(nowMs / 1000) + MOLLIE_STATE_TTL_SECONDS,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getSigningKey("sign");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the payload for a valid, unexpired state; null otherwise (never throws on bad input). */
export async function verifyMollieOAuthState(
  state: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<MollieOAuthStatePayload | null> {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  try {
    const key = await getSigningKey("verify");
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature) as BufferSource,
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as Partial<MollieOAuthStatePayload>;
    if (
      typeof payload.tenantId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }
    if (payload.expiresAt < Math.floor(nowMs / 1000)) return null;
    return payload as MollieOAuthStatePayload;
  } catch {
    return null;
  }
}

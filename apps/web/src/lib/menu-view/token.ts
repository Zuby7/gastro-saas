import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque, ephemeral, anonymous per-browser session token for menu-view
 * analytics dedup (ticket #67). Mirrors `apps/web/src/lib/cart/token.ts`'s
 * convention: the raw token lives only in an httpOnly cookie, never in the
 * database -- only its SHA-256 hash reaches Postgres
 * (`menu_view_attempts.session_token_hash`).
 */
export function createMenuViewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest -- the only form of the menu-view token that reaches Postgres. */
export function hashMenuViewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

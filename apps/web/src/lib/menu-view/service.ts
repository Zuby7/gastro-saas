import { createHash } from "node:crypto";
import { getClientIp } from "@/lib/auth/client-ip";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readMenuViewToken } from "./cookie";
import { hashMenuViewToken } from "./token";

/** SHA-256 hex digest -- the only form of the client IP that reaches Postgres for this feature. */
function hashIp(ip: string): string {
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

/**
 * Records one rate-limited, deduplicated `menu_viewed` analytics event for
 * `tenantSlug`, if this browser hasn't already recorded one for this tenant
 * today (see `record_menu_view()`,
 * supabase/migrations/20260905130000_menu_view_rate_limited_analytics.sql).
 *
 * `tenantId` must already be resolved server-side from the route slug (e.g.
 * via `resolveTenantIdBySlug`) -- never a client-supplied value, per
 * docs/security/tenant-isolation.md Layer 0.
 *
 * Deliberately called only from the public menu page itself (not from
 * `get_public_menu()`, a read-heavy function with no natural
 * once-per-visit boundary -- see the migration's header comment). Never
 * throws: analytics is best-effort and must never break menu rendering for
 * a real visitor.
 */
export async function recordMenuViewOnce(tenantSlug: string, tenantId: string): Promise<void> {
  try {
    const token = await readMenuViewToken(tenantSlug);
    if (!token) {
      // No session cookie for this tenant yet -- minted by
      // apps/web/src/middleware.ts for the base menu route. Nothing to
      // record without inventing a new anonymous identity here.
      return;
    }

    const sessionTokenHash = hashMenuViewToken(token);
    const ip = await getClientIp();
    // `getClientIp()` returns the literal string "unknown" (and warns) when
    // neither cf-connecting-ip nor x-forwarded-for resolved -- if that were
    // hashed and used as-is, EVERY such visitor would share one
    // (tenant_id, ip_hash) rate-limit bucket, capping the whole tenant at
    // MENU_VIEW_IP_RATE_LIMIT_MAX events total instead of per-visitor (Opus
    // finding, PR #129). Fall back to the session token's own hash as the
    // rate-limit bucket key in that case, so each anonymous browser still
    // gets its own independent bucket, same as it would with a real,
    // distinct IP.
    const ipHash = ip === "unknown" ? hashIp(`session-fallback:${sessionTokenHash}`) : hashIp(ip);

    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("record_menu_view", {
      p_tenant_id: tenantId,
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: ipHash,
    });

    if (error) {
      console.error("[menu-view] record_menu_view failed", error);
    }
  } catch (error) {
    console.error("[menu-view] recordMenuViewOnce failed", error);
  }
}

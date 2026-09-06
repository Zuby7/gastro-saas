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
 * Resolves the rate-limit bucket hash for a request. `getClientIp()` returns
 * the literal string "unknown" (and warns) when neither cf-connecting-ip nor
 * x-forwarded-for resolved -- if that were hashed and used as-is, EVERY such
 * visitor would share one (tenant_id, ip_hash) rate-limit bucket, capping the
 * whole tenant's budget instead of per-visitor (Opus finding, PR #129, and
 * the same defect reintroduced in the dish-view/add-to-cart recorders below,
 * PR #136 repair cycle). Falls back to the session token's own hash so each
 * anonymous browser still gets its own independent bucket.
 */
function resolveRateLimitBucketHash(ip: string, sessionTokenHash: string): string {
  return ip === "unknown" ? hashIp(`session-fallback:${sessionTokenHash}`) : hashIp(ip);
}

/**
 * Records one rate-limited, deduplicated `menu_viewed` analytics event for
 * `tenantSlug`, if this browser hasn't already recorded one for this tenant
 * today (see `record_menu_view()`,
 * supabase/migrations/20260906120000_menu_view_rate_limited_analytics.sql).
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
    const ipHash = resolveRateLimitBucketHash(ip, sessionTokenHash);

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

/**
 * Records one rate-limited, deduplicated `dish_view` analytics event for a
 * single dish, mirroring `recordMenuViewOnce()` exactly (see
 * `record_dish_view()`,
 * supabase/migrations/20260906090000_dish_view_and_add_to_cart_analytics.sql).
 *
 * Reuses the same per-tenant menu-view session cookie as `recordMenuViewOnce`
 * (ticket #67) -- both are "this anonymous browser session on this tenant's
 * public menu today" signals. `tenantId`/`dishId` must already be resolved
 * server-side (never client-supplied without independent verification).
 * Never throws: analytics is best-effort and must never break menu
 * rendering for a real visitor.
 */
export async function recordDishViewOnce(
  tenantSlug: string,
  tenantId: string,
  dishId: string,
): Promise<void> {
  try {
    const token = await readMenuViewToken(tenantSlug);
    if (!token) {
      return;
    }

    const ip = await getClientIp();
    const sessionTokenHash = hashMenuViewToken(token);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("record_dish_view", {
      p_tenant_id: tenantId,
      p_dish_id: dishId,
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: resolveRateLimitBucketHash(ip, sessionTokenHash),
    });

    if (error) {
      console.error("[menu-view] record_dish_view failed", error);
    }
  } catch (error) {
    console.error("[menu-view] recordDishViewOnce failed", error);
  }
}

/**
 * Records rate-limited, deduplicated `dish_view` analytics events for every
 * dish id in `dishIds` in a SINGLE database round trip (see
 * `record_dish_views()`,
 * supabase/migrations/20260906130000_dish_views_batched_rpc_and_retention.sql).
 *
 * Replaces the previous `Promise.all(dishIds.map(recordDishViewOnce))`
 * pattern at the public menu page's call site
 * (`apps/web/src/app/r/[slug]/page.tsx`): that fired one RPC call per dish,
 * each taking its own advisory lock on the SAME (tenant_id, ip_hash) key --
 * for N dishes shown on one render, N calls serialize against each other in
 * Postgres, directly blocking TTFB on the SEO-critical public menu page (PR
 * #136 Opus finding). This function takes one lock, does one rate-limit
 * count check, and does one bulk insert for the whole batch instead.
 *
 * `tenantId` must already be resolved server-side from the route slug, and
 * `dishIds` must already come from that same tenant's already-fetched (never
 * client-supplied) menu. Never throws: analytics is best-effort and must
 * never break menu rendering for a real visitor.
 */
export async function recordDishViewsOnce(
  tenantSlug: string,
  tenantId: string,
  dishIds: string[],
): Promise<void> {
  if (dishIds.length === 0) {
    return;
  }

  try {
    const token = await readMenuViewToken(tenantSlug);
    if (!token) {
      return;
    }

    const ip = await getClientIp();
    const sessionTokenHash = hashMenuViewToken(token);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("record_dish_views", {
      p_tenant_id: tenantId,
      p_dish_ids: dishIds,
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: resolveRateLimitBucketHash(ip, sessionTokenHash),
    });

    if (error) {
      console.error("[menu-view] record_dish_views failed", error);
    }
  } catch (error) {
    console.error("[menu-view] recordDishViewsOnce failed", error);
  }
}

/**
 * Records one rate-limited, deduplicated `add_to_cart` analytics event for a
 * single dish (see `record_add_to_cart_event()`,
 * supabase/migrations/20260906090000_dish_view_and_add_to_cart_analytics.sql).
 *
 * Called from the `add_cart_item()` success path
 * (`apps/web/src/app/r/[slug]/cart/actions.ts`'s `addToCartAction`), after
 * the cart mutation itself has already succeeded -- never blocks or fails
 * the cart action on an analytics error.
 */
export async function recordAddToCartEventOnce(
  tenantSlug: string,
  tenantId: string,
  dishId: string,
): Promise<void> {
  try {
    const token = await readMenuViewToken(tenantSlug);
    if (!token) {
      return;
    }

    const ip = await getClientIp();
    const sessionTokenHash = hashMenuViewToken(token);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("record_add_to_cart_event", {
      p_tenant_id: tenantId,
      p_dish_id: dishId,
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: resolveRateLimitBucketHash(ip, sessionTokenHash),
    });

    if (error) {
      console.error("[menu-view] record_add_to_cart_event failed", error);
    }
  } catch (error) {
    console.error("[menu-view] recordAddToCartEventOnce failed", error);
  }
}

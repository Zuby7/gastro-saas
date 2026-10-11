import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { buildMollieAuthorizeUrl } from "@/lib/mollie/client";
import { createOAuthNonce, signMollieOAuthState } from "@/lib/mollie/oauth-state";
import {
  MOLLIE_NONCE_COOKIE,
  MOLLIE_NONCE_COOKIE_MAX_AGE_SECONDS,
  getAppOrigin,
  paymentsPageUrl,
} from "@/lib/mollie/connection";

/**
 * Starts the Mollie OAuth flow (issue #195, ADR-0004). Gated server-side on
 * the Owner-only `payments.connect` permission. Tenant and user come from the
 * authenticated session, never from the query string; they are bound into a
 * signed, expiring `state` plus an httpOnly nonce cookie (CSRF defense).
 * This GET only redirects -- it changes no state.
 */
export async function GET() {
  const origin = getAppOrigin();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return NextResponse.redirect(new URL("/account", origin));
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.connect");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.redirect(paymentsPageUrl(origin, "forbidden"));
    }
    throw error;
  }

  let authorizeUrl: string;
  const nonce = createOAuthNonce();
  try {
    const state = await signMollieOAuthState({
      tenantId: membership.tenantId,
      userId: user.id,
      nonce,
    });
    authorizeUrl = buildMollieAuthorizeUrl({
      redirectUri: `${origin}/account/payments/mollie/callback`,
      state,
    });
  } catch {
    // Missing/invalid MOLLIE_* configuration -- fail closed, no details.
    return NextResponse.redirect(paymentsPageUrl(origin, "unavailable"));
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(MOLLIE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/account/payments/mollie",
    maxAge: MOLLIE_NONCE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

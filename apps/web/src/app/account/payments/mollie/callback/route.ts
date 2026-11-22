import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import {
  exchangeMollieAuthorizationCode,
  getMollieCurrentProfile,
  getMollieOrganizationId,
  isMolliePaypalEnabled,
} from "@/lib/mollie/client";
import { verifyMollieOAuthState } from "@/lib/mollie/oauth-state";
import { buildEncryptedTokenColumns } from "@/lib/mollie/tokens";
import {
  MOLLIE_NONCE_COOKIE,
  getAppOrigin,
  paymentsPageUrl,
  type MollieFlashCode,
} from "@/lib/mollie/connection";

/**
 * Mollie OAuth redirect target (issue #195, ADR-0004). Every step fails closed:
 * the signed `state` must be valid, unexpired, bound to the current session
 * user AND tenant, and match the httpOnly nonce cookie; only then is the
 * authorization code exchanged. Tokens are encrypted before they touch the
 * database and are never logged or reflected in the redirect.
 */
export async function GET(request: NextRequest) {
  const origin = getAppOrigin();
  const redirectWith = (code: MollieFlashCode) => {
    const response = NextResponse.redirect(paymentsPageUrl(origin, code));
    // The nonce is single-use whatever the outcome.
    response.cookies.set(MOLLIE_NONCE_COOKIE, "", {
      path: "/account/payments/mollie",
      maxAge: 0,
    });
    return response;
  };

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
      return redirectWith("forbidden");
    }
    throw error;
  }

  const params = request.nextUrl.searchParams;

  const state = await verifyMollieOAuthState(params.get("state"));
  const cookieNonce = request.cookies.get(MOLLIE_NONCE_COOKIE)?.value;
  if (
    !state ||
    state.userId !== user.id ||
    state.tenantId !== membership.tenantId ||
    !cookieNonce ||
    cookieNonce !== state.nonce
  ) {
    return redirectWith("invalid_state");
  }

  if (params.get("error")) {
    return redirectWith("denied");
  }

  const code = params.get("code");
  if (!code) {
    return redirectWith("failed");
  }

  try {
    const tokens = await exchangeMollieAuthorizationCode({
      code,
      redirectUri: `${origin}/account/payments/mollie/callback`,
    });
    const profile = await getMollieCurrentProfile(tokens.accessToken);
    const organizationId = await getMollieOrganizationId(tokens.accessToken);
    // A missing PayPal activation is a normal, recoverable state, not a failure.
    let paypalEnabled = false;
    try {
      paypalEnabled = await isMolliePaypalEnabled(tokens.accessToken, profile.id);
    } catch {
      paypalEnabled = false;
    }

    const encrypted = await buildEncryptedTokenColumns(membership.tenantId, tokens);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("tenant_mollie_accounts").upsert(
      {
        tenant_id: membership.tenantId,
        mollie_organization_id: organizationId,
        mollie_profile_id: profile.id,
        ...encrypted,
        status: "connected",
        paypal_enabled: paypalEnabled,
        created_by_user_id: user.id,
      },
      { onConflict: "tenant_id" },
    );
    if (error) {
      return redirectWith("failed");
    }

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: membership.tenantId,
      actorUserId: user.id,
      action: "mollie_account.connected",
      targetType: "tenant_mollie_account",
      targetId: membership.tenantId,
      metadata: { paypalEnabled },
    });

    return redirectWith(paypalEnabled ? "connected" : "connected_no_paypal");
  } catch (error) {
    // Log only the error class/message (our own errors never carry secrets).
    console.error(
      "[mollie-callback] connect failed",
      error instanceof Error ? error.name : "error",
    );
    return redirectWith("failed");
  }
}

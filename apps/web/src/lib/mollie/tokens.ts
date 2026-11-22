import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto";
import { MollieApiError, refreshMollieAccessToken, type MollieTokenResponse } from "./client";

/**
 * Persistence of encrypted Mollie tokens (service-role client only -- the
 * table has no grants for app-facing roles) and transparent refresh.
 */

const REFRESH_SKEW_MS = 60_000;

export class MollieNotConnectedError extends Error {
  constructor() {
    super("Für dieses Restaurant ist keine Mollie-Verbindung aktiv.");
    this.name = "MollieNotConnectedError";
  }
}

const accessAad = (tenantId: string) => `${tenantId}:mollie:access`;
const refreshAad = (tenantId: string) => `${tenantId}:mollie:refresh`;

export async function buildEncryptedTokenColumns(tenantId: string, tokens: MollieTokenResponse) {
  const access = await encryptSecret(tokens.accessToken, accessAad(tenantId));
  const refresh = await encryptSecret(tokens.refreshToken, refreshAad(tenantId));
  return {
    access_token_ciphertext: access.ciphertext,
    access_token_iv: access.iv,
    refresh_token_ciphertext: refresh.ciphertext,
    refresh_token_iv: refresh.iv,
    token_expires_at: new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString(),
  };
}

interface TokenRow {
  mollie_profile_id: string | null;
  access_token_ciphertext: string;
  access_token_iv: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  token_expires_at: string;
  status: string;
}

export interface MollieAccess {
  accessToken: string;
  profileId: string | null;
}

/**
 * Returns a valid access token for the tenant, refreshing (and persisting the
 * rotated tokens) when it expires within a minute. Throws
 * `MollieNotConnectedError` when there is no usable connection. A refresh
 * rejected by Mollie (4xx) flips the row to `needs_reauth`.
 */
export async function getMollieAccessForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<MollieAccess> {
  const { data } = await admin
    .from("tenant_mollie_accounts")
    .select(
      "mollie_profile_id, access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv, token_expires_at, status",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle<TokenRow>();

  if (!data || data.status !== "connected") {
    throw new MollieNotConnectedError();
  }

  const expiresAtMs = Date.parse(data.token_expires_at);
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > REFRESH_SKEW_MS) {
    const accessToken = await decryptSecret(
      { ciphertext: data.access_token_ciphertext, iv: data.access_token_iv },
      accessAad(tenantId),
    );
    return { accessToken, profileId: data.mollie_profile_id };
  }

  const refreshToken = await decryptSecret(
    { ciphertext: data.refresh_token_ciphertext, iv: data.refresh_token_iv },
    refreshAad(tenantId),
  );

  let refreshed: MollieTokenResponse;
  try {
    refreshed = await refreshMollieAccessToken(refreshToken);
  } catch (error) {
    // Only an explicit credential rejection (invalid_grant / 401) flips the
    // row; 429, 5xx and network failures are transient and just propagate.
    if (error instanceof MollieApiError && error.isAuthRejection) {
      await admin
        .from("tenant_mollie_accounts")
        .update({ status: "needs_reauth" })
        .eq("tenant_id", tenantId);
      throw new MollieNotConnectedError();
    }
    throw error;
  }

  const columns = await buildEncryptedTokenColumns(tenantId, refreshed);
  const { error: updateError } = await admin
    .from("tenant_mollie_accounts")
    .update(columns)
    .eq("tenant_id", tenantId);
  if (updateError) {
    // The new tokens are already valid at Mollie; failing loudly (without
    // details) lets callers retry rather than silently losing a rotation.
    throw new Error("Failed to persist refreshed Mollie tokens.");
  }

  return { accessToken: refreshed.accessToken, profileId: data.mollie_profile_id };
}

/** True when the tenant has a connected Mollie account with PayPal enabled. */
export async function isTenantPaypalAvailable(
  admin: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("tenant_mollie_accounts")
    .select("status, paypal_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ status: string; paypal_enabled: boolean }>();
  return Boolean(data && data.status === "connected" && data.paypal_enabled);
}

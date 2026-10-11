/**
 * Minimal Mollie API client (issue #195, ADR-0004) -- plain `fetch`, no SDK and
 * no Node-only APIs, so it runs on Cloudflare Workers. Server-only: it handles
 * the OAuth client secret and merchants' access tokens, which must never reach
 * the browser, logs, audit metadata or error messages.
 *
 * Live gate (mirrors `createStripeClient()`'s test-mode gate): payments are
 * created and fetched with `testmode: true` unless `MOLLIE_LIVE_ALLOWED === '1'`.
 *
 * NOTE: written against docs.mollie.com but never run against the real API in
 * this repo (no credentials existed) -- verify in the Mollie sandbox.
 */

export const MOLLIE_API_BASE = "https://api.mollie.com/v2";
export const MOLLIE_AUTHORIZE_URL = "https://my.mollie.com/oauth2/authorize";
export const MOLLIE_TOKEN_URL = "https://api.mollie.com/oauth2/tokens";

export const MOLLIE_OAUTH_SCOPES = [
  "payments.read",
  "payments.write",
  "refunds.read",
  "refunds.write",
  "profiles.read",
  "organizations.read",
] as const;

export class MollieApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 for a transport failure (no response received). */
    readonly status: number,
  ) {
    super(message);
    this.name = "MollieApiError";
  }

  /**
   * Mollie synchronously rejected the request (4xx) -- known not to have taken
   * effect. A transport failure (status 0) or 5xx is ambiguous.
   */
  get isDefinitive(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** True unless the operator explicitly allowed live payments. */
export function isMollieTestMode(): boolean {
  return process.env.MOLLIE_LIVE_ALLOWED !== "1";
}

export function getMollieOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MOLLIE_CLIENT_ID;
  const clientSecret = process.env.MOLLIE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET must be set to use Mollie.");
  }
  return { clientId, clientSecret };
}

/** Converts integer cents to Mollie's decimal string without floats. */
export function centsToMollieValue(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Mollie amounts must be a positive integer number of cents.");
  }
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${euros}.${rest}`;
}

/** Parses Mollie's decimal string into integer cents; null if malformed. */
export function mollieValueToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    return null;
  }
  const [euros, rest] = value.split(".");
  return Number(euros) * 100 + Number(rest);
}

export function buildMollieAuthorizeUrl(params: { redirectUri: string; state: string }): string {
  const { clientId } = getMollieOAuthConfig();
  const url = new URL(MOLLIE_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", MOLLIE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  return url.toString();
}

export interface MollieTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

async function mollieFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new MollieApiError("Mollie request failed (network).", 0);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function requestTokens(body: URLSearchParams): Promise<MollieTokenResponse> {
  const { clientId, clientSecret } = getMollieOAuthConfig();
  const response = await mollieFetch(MOLLIE_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const json = await readJson(response);
  if (
    !response.ok ||
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    // Never include the response body (could echo secrets) in the message.
    throw new MollieApiError(
      `Mollie token request failed (HTTP ${response.status}).`,
      response.status || 502,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

export function exchangeMollieAuthorizationCode(params: {
  code: string;
  redirectUri: string;
}): Promise<MollieTokenResponse> {
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  );
}

export function refreshMollieAccessToken(refreshToken: string): Promise<MollieTokenResponse> {
  return requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

/** Best-effort revoke of a merchant token on disconnect. Never throws. */
export async function revokeMollieToken(
  token: string,
  hint: "access_token" | "refresh_token",
): Promise<boolean> {
  try {
    const { clientId, clientSecret } = getMollieOAuthConfig();
    const response = await fetch(MOLLIE_TOKEN_URL, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token_type_hint: hint, token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function apiRequest(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const response = await mollieFetch(`${MOLLIE_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw new MollieApiError(
      `Mollie API request failed (HTTP ${response.status}).`,
      response.status,
    );
  }
  return json;
}

function testmodeQuery(): string {
  return isMollieTestMode() ? "testmode=true" : "";
}

export interface MollieProfile {
  id: string;
}

export async function getMollieCurrentProfile(accessToken: string): Promise<MollieProfile> {
  const json = await apiRequest(accessToken, "/profiles/me");
  if (typeof json.id !== "string") {
    throw new MollieApiError("Mollie profile response was malformed.", 502);
  }
  return { id: json.id };
}

export async function getMollieOrganizationId(accessToken: string): Promise<string | null> {
  try {
    const json = await apiRequest(accessToken, "/organizations/me");
    return typeof json.id === "string" ? json.id : null;
  } catch {
    return null;
  }
}

/** Is PayPal activated on the merchant's profile (in the current mode)? */
export async function isMolliePaypalEnabled(
  accessToken: string,
  profileId: string,
): Promise<boolean> {
  const query = [`profileId=${encodeURIComponent(profileId)}`, testmodeQuery()]
    .filter(Boolean)
    .join("&");
  const json = await apiRequest(accessToken, `/methods?${query}`);
  const embedded = json._embedded as { methods?: Array<{ id?: unknown }> } | undefined;
  return Boolean(embedded?.methods?.some((method) => method.id === "paypal"));
}

export interface CreateMolliePaymentParams {
  amountCents: number;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  orderId: string;
  tenantId: string;
  idempotencyKey: string;
}

export interface MolliePayment {
  id: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
  method: string | null;
  mode: string | null;
  profileId: string | null;
  metadata: { orderId?: string; tenantId?: string };
  checkoutUrl: string | null;
}

function parsePayment(json: Record<string, unknown>): MolliePayment {
  if (typeof json.id !== "string" || typeof json.status !== "string") {
    throw new MollieApiError("Mollie payment response was malformed.", 502);
  }
  const amount = json.amount as { value?: unknown; currency?: unknown } | undefined;
  const metadata =
    json.metadata && typeof json.metadata === "object"
      ? (json.metadata as Record<string, unknown>)
      : {};
  const links = json._links as { checkout?: { href?: unknown } } | undefined;
  return {
    id: json.id,
    status: json.status,
    amountCents: mollieValueToCents(amount?.value),
    currency: typeof amount?.currency === "string" ? amount.currency : null,
    method: typeof json.method === "string" ? json.method : null,
    mode: typeof json.mode === "string" ? json.mode : null,
    profileId: typeof json.profileId === "string" ? json.profileId : null,
    metadata: {
      orderId: typeof metadata.orderId === "string" ? metadata.orderId : undefined,
      tenantId: typeof metadata.tenantId === "string" ? metadata.tenantId : undefined,
    },
    checkoutUrl: typeof links?.checkout?.href === "string" ? links.checkout.href : null,
  };
}

/** `params.amountCents` must come from the server-recalculated order total. */
export async function createMolliePayment(
  accessToken: string,
  profileId: string,
  params: CreateMolliePaymentParams,
): Promise<MolliePayment> {
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToMollieValue(params.amountCents) },
    description: params.description,
    redirectUrl: params.redirectUrl,
    webhookUrl: params.webhookUrl,
    method: ["paypal"],
    metadata: { orderId: params.orderId, tenantId: params.tenantId },
    // With OAuth access tokens the profile must be named explicitly.
    profileId,
  };
  if (isMollieTestMode()) {
    body.testmode = true;
  }
  const json = await apiRequest(accessToken, "/payments", {
    method: "POST",
    body,
    idempotencyKey: params.idempotencyKey,
  });
  return parsePayment(json);
}

export async function getMolliePayment(
  accessToken: string,
  paymentId: string,
): Promise<MolliePayment> {
  const query = testmodeQuery();
  const json = await apiRequest(
    accessToken,
    `/payments/${encodeURIComponent(paymentId)}${query ? `?${query}` : ""}`,
  );
  return parsePayment(json);
}

export async function createMollieRefund(
  accessToken: string,
  paymentId: string,
  params: { amountCents: number; description: string; idempotencyKey: string },
): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToMollieValue(params.amountCents) },
    description: params.description,
  };
  if (isMollieTestMode()) {
    body.testmode = true;
  }
  const json = await apiRequest(accessToken, `/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    body,
    idempotencyKey: params.idempotencyKey,
  });
  if (typeof json.id !== "string") {
    throw new MollieApiError("Mollie refund response was malformed.", 502);
  }
  return { id: json.id, status: typeof json.status === "string" ? json.status : "unknown" };
}

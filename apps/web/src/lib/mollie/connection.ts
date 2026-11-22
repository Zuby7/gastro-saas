export const MOLLIE_NONCE_COOKIE = "gastro_mollie_oauth_nonce";
export const MOLLIE_NONCE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export type MollieFlashCode =
  | "connected"
  | "connected_no_paypal"
  | "disconnected"
  | "paypal_checked"
  | "forbidden"
  | "unavailable"
  | "denied"
  | "invalid_state"
  | "failed";

export function getAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Redirect target back to the payments page; `mollie` is a fixed code, never reflected input. */
export function paymentsPageUrl(origin: string, code: MollieFlashCode): URL {
  const url = new URL("/account/payments", origin);
  url.searchParams.set("mollie", code);
  return url;
}

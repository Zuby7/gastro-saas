import { headers } from "next/headers";

/**
 * Best-effort client IP resolution for the auth rate limiter. `x-forwarded-
 * for` (set by most reverse proxies/load balancers) is preferred; falls back
 * to Cloudflare's `cf-connecting-ip` (docs/platform/service-register.md:
 * this app is deployed behind Cloudflare). Never trusted for anything
 * security-critical beyond rate-limit bucketing -- these headers are
 * client-influenceable in principle, which is exactly why the rate limiter
 * also keys on the submitted email, not IP alone.
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    return first?.trim() || "unknown";
  }

  const cfConnectingIp = headerList.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return "unknown";
}

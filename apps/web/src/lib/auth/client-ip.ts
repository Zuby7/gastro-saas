import { headers } from "next/headers";

/**
 * Best-effort client IP resolution for the auth rate limiter.
 *
 * `cf-connecting-ip` is preferred: this app is deployed behind Cloudflare
 * (docs/platform/service-register.md, docs/decisions/assumptions.md) and
 * Cloudflare's edge sets/overwrites this header itself from the real TCP
 * connection -- it is not client-controlled, unlike `x-forwarded-for`.
 *
 * `x-forwarded-for` is only used as a local-dev fallback (no Cloudflare in
 * front of `next dev`), and even then only its *rightmost* hop is trusted --
 * the leftmost entry is exactly what an anonymous client supplies in its own
 * request and can set to anything (including a fake IP, or a comma-list of
 * fake IPs prepended in front of the real chain), so trusting it would let
 * an attacker rotate a claimed IP per request to defeat IP-scoped rate
 * limiting entirely (ticket #7 fix cycle 1, Opus finding: measured a ~7x
 * timing gap usable as an oracle, and separately, this header-order bug,
 * both closed in the same cycle). The rightmost hop is the one closest to
 * this server -- appended by the nearest trusted proxy, not the client.
 *
 * Never trusted for anything security-critical beyond rate-limit bucketing
 * -- these headers are client-influenceable in principle (a misconfigured
 * or absent Cloudflare front-end would fall through to the equally
 * spoofable XFF fallback), which is exactly why the rate limiter also keys
 * on the submitted email/ip *combination*, not IP alone.
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  const cfConnectingIp = headerList.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const rightmost = hops[hops.length - 1];
    if (rightmost) {
      return rightmost;
    }
  }

  // Neither header resolved -- callers that bucket by IP (e.g. rate
  // limiters) must not silently collapse every such visitor into one shared
  // "unknown" bucket (Opus finding, PR #129: this previously capped an
  // entire tenant's public menu-view rate limit at one shared bucket instead
  // of per-visitor). Warn so this is visible in server logs/monitoring
  // rather than only showing up as a mysterious rate-limit ceiling.
  console.warn("[client-ip] unable to resolve client IP from cf-connecting-ip or x-forwarded-for");
  return "unknown";
}

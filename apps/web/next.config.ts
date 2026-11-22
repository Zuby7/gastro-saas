import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * HTTP security headers (issue #204, audit 2026-11).
 *
 * These apply to every response the Worker itself generates (pages, route
 * handlers, server actions). Files served straight from the Workers static
 * assets binding never reach the Worker, so they get their headers from
 * `public/_headers` instead (see that file).
 *
 * The CSP is deliberately the pragmatic variant: Next's App Router emits
 * inline bootstrap scripts and inline styles, and a strict nonce-based policy
 * needs per-request nonces generated in middleware. That upgrade is tracked
 * as a follow-up in docs/security/threat-model.md.
 */
function supabaseOrigins(): { http: string[]; ws: string[] } {
  const http = ["https://*.supabase.co"];
  const ws = ["wss://*.supabase.co"];

  // Local development and self-hosted setups do not live under
  // *.supabase.co, so the configured project URL is allowed explicitly.
  // NEXT_PUBLIC_SUPABASE_URL is a public value, never a secret.
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (!url.hostname.endsWith(".supabase.co")) {
        http.push(url.origin);
        ws.push(url.origin.replace(/^http/, "ws"));
      }
    } catch {
      // An unparsable value is ignored here; the Supabase clients report it.
    }
  }

  return { http, ws };
}

function buildContentSecurityPolicy(): string {
  const { http, ws } = supabaseOrigins();
  // React Fast Refresh needs eval() in development only.
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // Dish photos are served through /media/*, which redirects to a signed
    // Supabase Storage URL, so the storage host must be allowed as well.
    `img-src 'self' data: blob: ${http.join(" ")}`,
    "font-src 'self'",
    `connect-src 'self' ${[...http, ...ws].join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    // Server actions redirect to Stripe's hosted pages (guest checkout and
    // Connect onboarding). With JavaScript enabled that is a plain
    // navigation, but the no-JS form fallback answers the POST with a 303,
    // and browsers enforce form-action on that redirect target too.
    "form-action 'self' https://checkout.stripe.com https://connect.stripe.com",
    "object-src 'none'",
  ].join("; ");
}

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
];

// These URLs carry a bearer token in the path (guest order access token,
// invitation token): never send them as a referrer, never index them. Listed
// after the catch-all rule so their Referrer-Policy wins for these paths.
const tokenUrlHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/r/:slug/orders/:path*", headers: tokenUrlHeaders },
      { source: "/invite/:path*", headers: tokenUrlHeaders },
    ];
  },
};

// Enables local `next dev` to resolve Cloudflare bindings (env vars, etc.)
// the same way the deployed Worker does. See docs/operations/deployment-strategy.md.
initOpenNextCloudflareForDev();

export default nextConfig;

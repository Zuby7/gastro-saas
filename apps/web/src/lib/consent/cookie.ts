/**
 * Ticket #146: cookie-consent gate for the `menu_view` analytics cookie
 * (ticket #67). This module has no `next/headers`/Next.js runtime import so
 * it can be shared between edge middleware (`apps/web/src/middleware.ts`,
 * which reads it to decide whether to mint the analytics cookie) and the
 * client component that writes it (`apps/web/src/app/r/[slug]/
 * cookie-consent-banner.tsx`) -- same sharing rationale as
 * `@/lib/menu-view/cookie-name`.
 *
 * This consent cookie itself is strictly necessary (it stores the visitor's
 * own cookie preference) -- it is set regardless of consent, same as the
 * cart/auth cookies, and is not itself gated behind a banner.
 */
export const CONSENT_COOKIE_NAME = "gastro_cookie_consent";

export type ConsentValue = "accepted" | "declined";

export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export function isConsentAccepted(rawValue: string | undefined | null): boolean {
  return rawValue === "accepted";
}

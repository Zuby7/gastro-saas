/**
 * Cookie-consent storage (tickets #146, #162). This module has no
 * `next/headers`/Next.js runtime import so it can be shared between edge
 * middleware (which decides whether the statistics cookie may exist) and the
 * client components that write/read the decision.
 *
 * The decision is stored in the strictly necessary first-party cookie
 * `gastro_cookie_consent` as URL-encoded JSON `{ version, timestamp,
 * statistics }`. Version + timestamp + choice is the proof of consent
 * (Art. 7 Abs. 1 DSGVO) and contains no personal data. There is deliberately
 * no server-side consent log.
 *
 * Legacy values from ticket #146 (`accepted` / `declined`) carry no version
 * or timestamp and are treated as outdated: the visitor is asked again and
 * no statistics cookie is allowed until a valid decision exists.
 */
export const CONSENT_COOKIE_NAME = "gastro_cookie_consent";

/** Bump whenever the cookie inventory or banner wording changes materially; forces a re-prompt. */
export const CONSENT_VERSION = 2;

/** A decision expires after 6 months and the visitor is asked again. */
export const CONSENT_VALIDITY_SECONDS = 60 * 60 * 24 * 183;
export const CONSENT_COOKIE_MAX_AGE_SECONDS = CONSENT_VALIDITY_SECONDS;

export interface ConsentRecord {
  version: number;
  /** ISO-8601 timestamp of the decision. */
  timestamp: string;
  statistics: boolean;
}

export type ConsentState =
  { status: "none" } | { status: "outdated" } | { status: "valid"; record: ConsentRecord };

export function serializeConsent(statistics: boolean, now: Date = new Date()): string {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    timestamp: now.toISOString(),
    statistics,
  };
  return encodeURIComponent(JSON.stringify(record));
}

export function parseConsent(
  rawValue: string | undefined | null,
  now: Date = new Date(),
): ConsentState {
  if (!rawValue) {
    return { status: "none" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(rawValue));
  } catch {
    // Legacy "accepted"/"declined" or any garbage: outdated -> re-prompt.
    return { status: "outdated" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { status: "outdated" };
  }
  const { version, timestamp, statistics } = parsed as Record<string, unknown>;
  if (
    version !== CONSENT_VERSION ||
    typeof timestamp !== "string" ||
    typeof statistics !== "boolean"
  ) {
    return { status: "outdated" };
  }
  const decidedAt = Date.parse(timestamp);
  if (Number.isNaN(decidedAt)) {
    return { status: "outdated" };
  }
  const ageMs = now.getTime() - decidedAt;
  // Future timestamps (clock tampering) are never trusted.
  if (ageMs < 0 || ageMs > CONSENT_VALIDITY_SECONDS * 1000) {
    return { status: "outdated" };
  }
  return { status: "valid", record: { version, timestamp, statistics } };
}

/** True only for a valid, current decision that opted in to statistics. */
export function hasStatisticsConsent(
  rawValue: string | undefined | null,
  now: Date = new Date(),
): boolean {
  const state = parseConsent(rawValue, now);
  return state.status === "valid" && state.record.statistics;
}

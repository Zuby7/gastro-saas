/**
 * Rejects secret-/payment-shaped values before they ever reach the
 * append-only `audit_logs.metadata` column. Deliberately heuristic, not a
 * general-purpose secret scanner (that's gitleaks' job in CI) — this only
 * needs to catch the realistic ways a developer would accidentally log a
 * credential or card number while building an audit-log call site.
 *
 * Checked shapes:
 * - Key names that are conventionally secret (password, token, secret, ...)
 * - JWT-shaped strings (header.payload.signature, base64url segments)
 * - Card-number-shaped strings (13-19 digits, with or without separators)
 * - Common API-key prefixes (sk_, pk_, sb_secret_, ...)
 */

const SECRET_KEY_NAME_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth(orization)?|card[_-]?number|cvv|cvc|ssn|iban)/i;

const JWT_PATTERN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

const API_KEY_PREFIX_PATTERN =
  /^(sk_|pk_|sb_secret_|sb_publishable_|whsec_|rk_|ghp_|gho_|github_pat_)/i;

function isCardNumberShaped(value: string): boolean {
  const digitsOnly = value.replace(/[\s-]/g, "");
  return /^\d{13,19}$/.test(digitsOnly);
}

function isSecretShapedValue(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return JWT_PATTERN.test(value) || API_KEY_PREFIX_PATTERN.test(value) || isCardNumberShaped(value);
}

export class UnsafeAuditMetadataError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`Refusing to record audit metadata at "${path}": ${reason}`);
    this.name = "UnsafeAuditMetadataError";
  }
}

/**
 * Recursively validates that `metadata` contains no secret-/payment-shaped
 * keys or values. Throws {@link UnsafeAuditMetadataError} on the first
 * violation found. Safe to call on any JSON-serializable value.
 */
export function assertSafeAuditMetadata(metadata: unknown, path = "metadata"): void {
  if (metadata === null || metadata === undefined) {
    return;
  }

  if (Array.isArray(metadata)) {
    metadata.forEach((item, index) => assertSafeAuditMetadata(item, `${path}[${index}]`));
    return;
  }

  if (typeof metadata === "object") {
    for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (SECRET_KEY_NAME_PATTERN.test(key)) {
        throw new UnsafeAuditMetadataError(
          childPath,
          `key name "${key}" looks like a secret/payment field`,
        );
      }
      assertSafeAuditMetadata(value, childPath);
    }
    return;
  }

  if (isSecretShapedValue(metadata)) {
    throw new UnsafeAuditMetadataError(path, "value looks like a JWT, API key, or card number");
  }
}

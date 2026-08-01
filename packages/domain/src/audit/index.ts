import { assertSafeAuditMetadata, UnsafeAuditMetadataError } from "./secret-detection";

export { UnsafeAuditMetadataError, assertSafeAuditMetadata };

/**
 * Minimal query-capable client `recordAuditEvent` needs. Deliberately not
 * tied to `pg`/Supabase directly — `packages/domain` stays a pure module per
 * `docs/architecture/domain-boundaries.md`; the caller (an API route,
 * `packages/database`, or a test) supplies the actual DB client.
 */
export interface AuditQueryClient {
  query(sql: string, params: readonly unknown[]): Promise<unknown>;
}

export interface RecordAuditEventInput {
  /** Resolved server-side from the caller's session/membership -- never a client-supplied value. */
  tenantId: string;
  /** Null for system-initiated actions with no acting user. */
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Safe, non-secret structured context. Rejected if it looks like a credential or payment value. */
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Write-only interface for `audit_logs`. Validates `metadata` for
 * secret-/payment-shaped values (throws {@link UnsafeAuditMetadataError}
 * instead of writing) and then appends one immutable row.
 *
 * No read function is provided -- the `audit.read` permission is defined
 * (see docs/data/domain-model.md) but not enforced/used anywhere yet.
 */
export async function recordAuditEvent(
  client: AuditQueryClient,
  input: RecordAuditEventInput,
): Promise<void> {
  if (input.metadata !== undefined) {
    assertSafeAuditMetadata(input.metadata);
  }

  await client.query(
    `insert into audit_logs
       (tenant_id, actor_user_id, action, target_type, target_id, metadata, correlation_id)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, gen_random_uuid()))`,
    [
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.correlationId ?? null,
    ],
  );
}

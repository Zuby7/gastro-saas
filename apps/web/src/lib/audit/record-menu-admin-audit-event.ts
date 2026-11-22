import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeAuditMetadata } from "@gastro-saas/domain";

/**
 * Appends one `audit_logs` row for a tenant-admin mutation (restaurant
 * profile, dish create/archive, image upload, ...), per tickets #11/#12's
 * "mutations must be audited" requirement (`docs/data/domain-model.md`
 * "Audit") -- Opus cycle-3 review, artifacts/reviews/epic-3-5-batch.json.
 *
 * Deliberately does NOT go through `recordAuditEvent()` in
 * `packages/domain/src/audit` directly: that function's `AuditQueryClient`
 * interface expects a raw parameterized-SQL-capable client (`query(sql,
 * params)`), which in this app's request path would mean either a raw `pg`
 * connection (the exact superuser-bypasses-RLS anti-pattern ticket #7 fix
 * cycle 1 already removed from the login-audit path, see
 * `apps/web/src/lib/audit/login-audit.ts`) or a service-role client (more
 * privilege than this call site needs). These server actions already hold
 * an authenticated, RLS-scoped Supabase client for the acting user -- the
 * direct INSERT into `audit_logs` is denied for `authenticated` since issue
 * #205 (migration `20261121090000`); the row is written through the SECURITY
 * DEFINER RPC `record_audit_event()` (actor is always auth.uid(), caller must
 * be a tenant member). Until that migration is applied the helper falls back
 * to the former direct insert so the app can be deployed first.
 * This helper still reuses `assertSafeAuditMetadata()` (the same
 * secret-/payment-shape guard `recordAuditEvent()` uses) so metadata is
 * validated identically either way.
 *
 * Audit logging must never break the mutation it's attached to -- failures
 * are caught and logged, never thrown, matching the fire-and-forget
 * tolerance already established for `recordFailedLoginAttempt()`.
 */
export async function recordMenuAdminAuditEvent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    if (input.metadata !== undefined) {
      assertSafeAuditMetadata(input.metadata);
    }

    const rpcError = await tryRecordViaRpc(supabase, input);

    if (rpcError === null) {
      return;
    }

    if (!isRpcMissingError(rpcError)) {
      console.error("[audit] failed to record audit event", input.action, rpcError);
      return;
    }

    // Transitional fallback (issue #205): record_audit_event() does not
    // exist yet on a database that has not applied migration
    // 20261121090000, where the old direct INSERT policy is still in place.
    // Once that migration is applied the RPC path above always succeeds.
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[audit] failed to record audit event", input.action, error);
    }
  } catch (error) {
    console.error("[audit] failed to record audit event", input.action, error);
  }
}

interface RpcErrorLike {
  code?: string;
  message?: string;
}

/** Returns null on success, otherwise the error (a thrown error becomes an error-like value). */
async function tryRecordViaRpc(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<RpcErrorLike | null> {
  try {
    const { error } = await supabase.rpc("record_audit_event", {
      p_tenant_id: input.tenantId,
      p_action: input.action,
      p_target_type: input.targetType,
      p_target_id: input.targetId ?? null,
      p_metadata: input.metadata ?? {},
    });
    return error ?? null;
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

/** PGRST202 = PostgREST cannot find the function; 42883 = Postgres undefined_function. */
function isRpcMissingError(error: RpcErrorLike): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

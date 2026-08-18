"use server";

import { revalidatePath } from "next/cache";
import type { OrderStatus } from "@gastro-saas/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import {
  listTenantOrdersForDashboard,
  type ListTenantOrdersForDashboardResult,
} from "@/lib/orders/dashboard-service";
import {
  InvalidOrderStatusTransitionError,
  OrderNotFoundError,
  transitionOrderStatus,
} from "@/lib/orders/status-service";

/**
 * Polled by the client-side `OrderBoard` component (see `./order-board.tsx`)
 * to keep the staff order dashboard live without any realtime infrastructure
 * -- mirrors `apps/web/src/app/r/[slug]/orders/[token]/actions.ts`'s
 * `pollOrderStatus` precedent.
 *
 * Deliberately takes no `tenantId` parameter: tenant context is always
 * re-resolved here from the caller's own session membership
 * (`getCurrentMembership`), never trusted from the client, even though the
 * client already knows which tenant it's polling for -- this repo's
 * tenant-isolation rule ("tenant context comes only from the authenticated
 * session's membership record, never a client-supplied ID"). Returns `null`
 * for "not authenticated" / "no membership" / "missing orders.read" alike so
 * the client can't distinguish those cases and stops polling either way.
 */
export async function pollTenantOrders(
  limit?: number,
): Promise<ListTenantOrdersForDashboardResult | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return null;
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "orders.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return null;
    }
    throw error;
  }

  return listTenantOrdersForDashboard(supabase, { tenantId: membership.tenantId, limit });
}

export interface TransitionOrderStatusActionResult {
  error?: string;
  status?: OrderStatus;
}

/**
 * Server action backing the board's status-change buttons (Epic 8, ticket
 * #28). Gated on `orders.manage` -- both here (`requireTenantPermission`)
 * and independently by `transition_order_status()`'s own re-check, matching
 * this repo's "two enforcement layers" standard for `payments.refund` in
 * `apps/web/src/app/account/orders/[orderId]/actions.ts`'s
 * `issueRefundAction`.
 *
 * Deliberately re-resolves `tenantId` from the caller's own session
 * membership on every call, exactly like `pollTenantOrders` above -- never
 * trusts a client-supplied tenant id, even though the client already knows
 * which tenant's board it's viewing.
 */
export async function transitionOrderStatusAction(
  orderId: string,
  toStatus: OrderStatus,
): Promise<TransitionOrderStatusActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sie sind nicht angemeldet." };
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "orders.manage");
    // Epic 8 Opus batch review, finding 4: cancellation is a distinct,
    // separately-scoped action from the rest of the kitchen-workflow
    // preparation lifecycle -- require orders.cancel in addition to
    // orders.manage. transition_order_status() independently re-checks the
    // same thing server-side; this is only the cheaper first layer.
    if (toStatus === "cancelled") {
      await requireTenantPermission(supabase, membership.tenantId, "orders.cancel");
    }
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Bestellstatus zu ändern.",
      };
    }
    throw error;
  }

  try {
    const status = await transitionOrderStatus(supabase, {
      tenantId: membership.tenantId,
      orderId,
      toStatus,
    });

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: membership.tenantId,
      actorUserId: user.id,
      action: "order.status_changed",
      targetType: "order",
      targetId: orderId,
      metadata: { toStatus: status },
    });

    revalidatePath("/account/orders");
    return { status };
  } catch (error) {
    if (error instanceof InvalidOrderStatusTransitionError) {
      return { error: error.message };
    }
    if (error instanceof OrderNotFoundError) {
      return { error: error.message };
    }
    return {
      error: "Der Bestellstatus konnte nicht geändert werden. Bitte versuchen Sie es erneut.",
    };
  }
}

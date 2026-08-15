"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import {
  issueRefundForOrder,
  PaymentNotRefundableError,
  RefundAwaitingReconciliationError,
  RefundExceedsRemainingAmountError,
  RefundInvalidAmountError,
} from "@/lib/payments/refund-service";
import { RefundSchema } from "./schemas";

export interface RefundActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Issues a full or partial refund for an order's paid payment (ticket #26,
 * risk:payment). Layer 1 of this repo's "two enforcement layers" standard
 * for `payments.refund` -- layer 2 is the `refunds_insert_payments_refund`/
 * `refunds_update_payments_refund` RLS policies re-checked independently by
 * `apps/web/src/lib/payments/refund-service.ts`'s writes through this same
 * authenticated session client.
 */
export async function issueRefundAction(
  _prevState: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  const parsed = RefundSchema.safeParse({
    orderId: formData.get("orderId"),
    amountCents: formData.get("amountCents"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.refund");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, Rückerstattungen auszulösen.",
      };
    }
    throw error;
  }

  try {
    await issueRefundForOrder(supabase, {
      tenantId: membership.tenantId,
      orderId: parsed.data.orderId,
      actorUserId: user.id,
      amountCents: Number(parsed.data.amountCents),
      reason: parsed.data.reason,
    });
  } catch (error) {
    if (
      error instanceof RefundExceedsRemainingAmountError ||
      error instanceof PaymentNotRefundableError ||
      error instanceof RefundInvalidAmountError ||
      error instanceof RefundAwaitingReconciliationError
    ) {
      return { error: error.message };
    }
    return {
      error: "Die Rückerstattung konnte nicht durchgeführt werden. Bitte versuchen Sie es erneut.",
    };
  }

  revalidatePath(`/account/orders/${parsed.data.orderId}`);
  return { success: "Rückerstattung wurde ausgelöst." };
}

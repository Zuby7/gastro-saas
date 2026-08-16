import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { listTenantOrdersForDashboard } from "@/lib/orders/dashboard-service";
import { OrderBoard } from "./order-board";

/**
 * Live order dashboard for staff (Epic 8, ticket #27). Gated on `orders.read`
 * (both here, server-side, and independently by the `orders_select_orders_read`
 * RLS policy -- see the ticket's migration). Renders the initial page
 * server-side (so the first paint, and any no-JS fallback, already shows
 * the current board) and hands the data to the client-side `OrderBoard`,
 * which polls `./actions.ts`'s `pollTenantOrders` on an interval for live
 * updates (no realtime infra set up in this codebase yet -- see the
 * customer-facing `order-status-live.tsx` precedent this mirrors).
 */
export default async function OrdersDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "orders.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-neutral-50 p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um das Bestell-Dashboard einzusehen.
          </p>
          <Link
            href="/account"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const initial = await listTenantOrdersForDashboard(supabase, { tenantId: membership.tenantId });

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Bestell-Dashboard
          </h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <OrderBoard initialOrders={initial.orders} initialHasMore={initial.hasMore} />
      </div>
    </main>
  );
}

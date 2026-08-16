import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@gastro-saas/domain";

/**
 * Staff order dashboard (Epic 8, ticket #27). Statuses shown on the board --
 * deliberately excludes `awaiting_payment`: an order that hasn't completed
 * payment yet isn't a real "incoming order" for staff purposes (it only
 * becomes one once ticket #25's payment webhook transitions it to
 * `received`), and showing it would let staff act on an order the guest may
 * never actually pay for.
 */
export const ORDER_DASHBOARD_STATUSES: readonly OrderStatus[] = [
  "received",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

export const DEFAULT_ORDER_DASHBOARD_PAGE_SIZE = 50;

/**
 * Narrow payment-status label returned by `get_tenant_order_payment_statuses()`
 * (see the ticket #27 migration's header for why this projection is narrower
 * than the full `payments` table read gated on `payments.read`).
 */
export type OrderPaymentStatus =
  "unpaid" | "processing" | "paid" | "partially_refunded" | "refunded" | "failed";

export interface TenantOrderRow {
  id: string;
  status: OrderStatus;
  fulfillmentType: string;
  customerName: string;
  tableIdentifier: string | null;
  totalCents: number;
  currency: string;
  createdAt: string;
  paymentStatus: OrderPaymentStatus;
}

interface RawOrderRow {
  id: string;
  status: OrderStatus;
  fulfillment_type: string;
  customer_name: string;
  table_identifier: string | null;
  total_cents: number;
  currency: string;
  created_at: string;
}

interface RawPaymentStatusRow {
  order_id: string;
  payment_status: OrderPaymentStatus;
}

export interface ListTenantOrdersForDashboardOptions {
  tenantId: string;
  /** Page size (offset-free "top N most recent" pagination) -- see module header. */
  limit?: number;
}

export interface ListTenantOrdersForDashboardResult {
  orders: TenantOrderRow[];
  /** True if more orders exist beyond `limit` -- drives the board's "load more" control. */
  hasMore: boolean;
}

/**
 * Tenant-scoped, paginated read of the current order list for the staff
 * dashboard (ticket #27's "Order-List-Endpunkt (tenant-gescoped, paginiert)"
 * acceptance criterion). `tenantId` must already be resolved server-side from
 * the caller's own session membership (never a client-supplied value) --
 * enforcement happens twice: the caller is expected to have already called
 * `requireTenantPermission(supabase, tenantId, 'orders.read')`, and the
 * `orders_select_orders_read` RLS policy independently re-checks the same
 * permission for the `.from("orders")` read below.
 *
 * Pagination is a simple "top N most recent, oldest column data still
 * included" strategy: it orders by `created_at desc` and fetches `limit + 1`
 * rows to cheaply detect whether more exist, rather than a second `count(*)`
 * query. This is deliberately simple (no cursor/offset) since the board's own
 * use case is "show me what's happening now", not deep historical paging --
 * `/account/orders/[orderId]` already exists for looking up one specific
 * historical order directly by id.
 */
export async function listTenantOrdersForDashboard(
  supabase: SupabaseClient,
  options: ListTenantOrdersForDashboardOptions,
): Promise<ListTenantOrdersForDashboardResult> {
  const limit = options.limit ?? DEFAULT_ORDER_DASHBOARD_PAGE_SIZE;

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, status, fulfillment_type, customer_name, table_identifier, total_cents, currency, created_at",
    )
    .eq("tenant_id", options.tenantId)
    .in("status", ORDER_DASHBOARD_STATUSES)
    .order("created_at", { ascending: false })
    .limit(limit + 1)
    .returns<RawOrderRow[]>();

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const paymentStatuses = await getPaymentStatusesForOrders(
    supabase,
    options.tenantId,
    page.map((row) => row.id),
  );

  const orders: TenantOrderRow[] = page.map((row) => ({
    id: row.id,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    customerName: row.customer_name,
    tableIdentifier: row.table_identifier,
    totalCents: row.total_cents,
    currency: row.currency,
    createdAt: row.created_at,
    paymentStatus: paymentStatuses.get(row.id) ?? "unpaid",
  }));

  return { orders, hasMore };
}

async function getPaymentStatusesForOrders(
  supabase: SupabaseClient,
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, OrderPaymentStatus>> {
  if (orderIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.rpc("get_tenant_order_payment_statuses", {
    p_tenant_id: tenantId,
    p_order_ids: orderIds,
  });

  if (error) {
    throw error;
  }

  const map = new Map<string, OrderPaymentStatus>();
  for (const row of (data ?? []) as RawPaymentStatusRow[]) {
    map.set(row.order_id, row.payment_status);
  }
  return map;
}

/** Groups a flat order list into the board's per-status columns, in `ORDER_DASHBOARD_STATUSES` order. */
export function groupOrdersByStatus(
  orders: TenantOrderRow[],
): Record<OrderStatus, TenantOrderRow[]> {
  const grouped = Object.fromEntries(
    ORDER_DASHBOARD_STATUSES.map((status) => [status, [] as TenantOrderRow[]]),
  ) as Record<OrderStatus, TenantOrderRow[]>;

  for (const order of orders) {
    const column = grouped[order.status];
    if (column) {
      column.push(order);
    }
  }

  return grouped;
}

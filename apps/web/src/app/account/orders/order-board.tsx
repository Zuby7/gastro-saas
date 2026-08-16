"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderStatus } from "@gastro-saas/domain";
import {
  ORDER_DASHBOARD_STATUSES,
  DEFAULT_ORDER_DASHBOARD_PAGE_SIZE,
  groupOrdersByStatus,
  type TenantOrderRow,
} from "@/lib/orders/dashboard-service";
import { describeOrderChanges } from "@/lib/orders/dashboard-diff";
import {
  paymentStatusLabel,
  staffOrderStatusColumnLabel,
} from "@/lib/orders/status-labels";
import { formatOrderTimestamp } from "@/lib/orders/format";
import { pollTenantOrders } from "./actions";

const POLL_INTERVAL_MS = 10_000;

interface OrderBoardProps {
  initialOrders: TenantOrderRow[];
  initialHasMore: boolean;
}

/**
 * Client-side board + polling for the staff order dashboard (ticket #27).
 * Renders one column per `ORDER_DASHBOARD_STATUSES` entry and polls
 * `pollTenantOrders` (a server action that re-derives tenant/permission from
 * the caller's own session on every call, see `./actions.ts`) every
 * {@link POLL_INTERVAL_MS} for live updates -- no websockets/realtime, matching
 * this repo's `order-status-live.tsx` precedent for the guest-facing page.
 *
 * Accessibility (ticket's "Statuswechsel für Screenreader ansagbar"
 * acceptance criterion): an `aria-live="polite"` region below the board
 * announces new orders and status changes detected between polls
 * (`describeOrderChanges`, a pure/unit-tested diff -- see
 * `lib/orders/dashboard-diff.ts`). The region's text is only updated when
 * something actually changed, so a screen reader announces each change once
 * instead of repeating the same text on every poll tick.
 */
export function OrderBoard({ initialOrders, initialHasMore }: OrderBoardProps) {
  const [orders, setOrders] = useState<TenantOrderRow[]>(initialOrders);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [limit, setLimit] = useState(
    Math.max(initialOrders.length, DEFAULT_ORDER_DASHBOARD_PAGE_SIZE),
  );
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const ordersRef = useRef(orders);
  const limitRef = useRef(limit);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    limitRef.current = limit;
  }, [limit]);

  const refresh = useCallback(async (nextLimit?: number) => {
    const result = await pollTenantOrders(nextLimit ?? limitRef.current);
    if (!result) {
      return;
    }

    const changeAnnouncement = describeOrderChanges(ordersRef.current, result.orders);
    if (changeAnnouncement) {
      setAnnouncement(changeAnnouncement);
    }

    setOrders(result.orders);
    setHasMore(result.hasMore);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleLoadMore = useCallback(() => {
    const nextLimit = limit + DEFAULT_ORDER_DASHBOARD_PAGE_SIZE;
    setLimit(nextLimit);
    void refresh(nextLimit);
  }, [limit, refresh]);

  const grouped = groupOrdersByStatus(orders);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {ORDER_DASHBOARD_STATUSES.map((status) => (
          <OrderColumn key={status} status={status} orders={grouped[status] ?? []} />
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={handleLoadMore}
          className="w-fit rounded-md border border-neutral-300 bg-neutral-0 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          Mehr laden
        </button>
      ) : null}
    </div>
  );
}

function OrderColumn({
  status,
  orders,
}: {
  status: OrderStatus;
  orders: TenantOrderRow[];
}) {
  const headingId = `order-column-${status}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <h2 id={headingId} className="text-sm font-semibold text-foreground">
        {staffOrderStatusColumnLabel(status)}{" "}
        <span className="font-normal text-foreground-secondary">({orders.length})</span>
      </h2>

      {orders.length === 0 ? (
        <p className="text-sm text-foreground-secondary">Keine Bestellungen.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-sm text-foreground"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{order.customerName}</span>
                <span className="text-xs text-foreground-secondary">
                  {formatOrderTimestamp(order.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                <span>
                  {order.fulfillmentType === "table" && order.tableIdentifier
                    ? `Tisch ${order.tableIdentifier}`
                    : order.fulfillmentType === "pickup"
                      ? "Abholung"
                      : order.fulfillmentType}
                </span>
                <span>
                  {(order.totalCents / 100).toFixed(2)} {order.currency}
                </span>
              </div>
              <span className="w-fit rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-foreground">
                {paymentStatusLabel(order.paymentStatus)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

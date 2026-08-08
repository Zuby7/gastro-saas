"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderStatus } from "@gastro-saas/domain";
import { isTerminalOrderStatus } from "@gastro-saas/domain";
import { orderStatusDescription, orderStatusLabel } from "@/lib/orders/status-labels";
import { pollOrderStatus } from "./actions";

const POLL_INTERVAL_MS = 20_000;

interface OrderStatusLiveProps {
  tenantSlug: string;
  token: string;
  initialStatus: OrderStatus;
  /**
   * Full order id (UUID). Only ever used here to derive a short, display-only
   * order token (first 8 chars, uppercased) shown in the ticket-stamp badge
   * -- purely presentational, never used for lookups/authorization (those
   * stay keyed off the guest access `token`, see `./actions.ts`).
   */
  orderId: string;
}

/**
 * Client-side companion to the (otherwise fully server-rendered) order-status
 * page. Fixes Opus epic-6 batch review finding 1: an `aria-live="polite"`
 * region is only a real accessibility feature if the content it wraps can
 * actually change after initial render. This component polls
 * `pollOrderStatus` (a server action re-using the exact same
 * token-hash-based lookup/authorization as the initial page load, see
 * `./actions.ts`) on a plain interval -- no websockets/realtime, a kitchen
 * order status changing every 20-30s is plenty timely -- and only updates
 * (and therefore only re-announces) the `aria-live` region's text when the
 * status actually changes, so a screen reader announces the new status once
 * rather than repeating the same text on every poll.
 *
 * Stops polling once the status reaches a terminal state
 * (`isTerminalOrderStatus`, e.g. `completed`/`cancelled`) since it can never
 * change again from there.
 *
 * Renders from `initialStatus` (passed down from the server-rendered initial
 * fetch) so the first paint -- and the no-JS fallback -- always shows the
 * correct status; polling is a progressive enhancement layered on top.
 */
export function OrderStatusLive({
  tenantSlug,
  token,
  initialStatus,
  orderId,
}: OrderStatusLiveProps) {
  const orderToken = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (isTerminalOrderStatus(initialStatus)) {
      return;
    }

    let cancelled = false;

    const interval = setInterval(() => {
      void pollOrderStatus(tenantSlug, token).then((result) => {
        if (cancelled || !result) {
          return;
        }
        if (result.status !== statusRef.current) {
          setStatus(result.status);
        }
        if (isTerminalOrderStatus(result.status)) {
          clearInterval(interval);
        }
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantSlug, token, initialStatus]);

  return (
    // The order-status page's strongest candidate for the full ticket
    // treatment (see packages/ui/src/tokens.ts's design plan) -- this card
    // IS literally the customer's order ticket, so both the torn-edge motif
    // and the stamped order-number badge are functionally motivated here.
    <section
      aria-live="polite"
      className="ticket-edge rounded-t-lg border border-b-0 border-ember-300 bg-neutral-0 p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground-secondary">Aktueller Status</p>
        <span
          className="ticket-stamp px-2 py-0.5 font-mono text-xs font-bold tracking-widest"
          aria-label={`Bestellnummer ${orderToken}`}
        >
          #{orderToken}
        </span>
      </div>
      <p className="mt-1 font-display text-2xl font-semibold text-ember-700">
        {orderStatusLabel(status)}
      </p>
      <p className="mt-2 text-sm text-foreground-secondary">{orderStatusDescription(status)}</p>
    </section>
  );
}

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatusLive } from "./order-status-live";

const pollOrderStatusMock = vi.fn();

vi.mock("./actions", () => ({
  pollOrderStatus: (...args: unknown[]) => pollOrderStatusMock(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  pollOrderStatusMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Covers Opus epic-6 batch review finding 1: `aria-live="polite"` on the
 * order-status page is only a real accessibility feature if the region's
 * text can actually change after initial render. This exercises the
 * client-side polling loop directly (`OrderStatusLive`), proving the
 * `aria-live` region's announced text updates when the polled status
 * changes, and does *not* update (avoiding redundant screen-reader
 * announcements) when it doesn't.
 */
describe("OrderStatusLive", () => {
  it("renders the ticket-stamp order-number badge derived from the order id, with a matching aria-label", () => {
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="received"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    const badge = screen.getByLabelText("Bestellnummer 11112222");
    expect(badge).toHaveTextContent("#11112222");
  });

  it("renders the initial status inside a polite live region without waiting for any poll", () => {
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="received"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    const region = screen.getByText("Aktueller Status").closest("section");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Bestellung eingegangen")).toBeInTheDocument();
    expect(pollOrderStatusMock).not.toHaveBeenCalled();
  });

  it("updates the announced status text once the poll reports a status change", async () => {
    pollOrderStatusMock.mockResolvedValue({ status: "preparing" });
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="received"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(pollOrderStatusMock).toHaveBeenCalledWith("demo", "raw-token");
    expect(screen.getByText("Wird zubereitet")).toBeInTheDocument();
    expect(screen.queryByText("Bestellung eingegangen")).not.toBeInTheDocument();
  });

  it("does not re-render/re-announce when the polled status is unchanged", async () => {
    pollOrderStatusMock.mockResolvedValue({ status: "received" });
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="received"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(pollOrderStatusMock).toHaveBeenCalledOnce();
    expect(screen.getByText("Bestellung eingegangen")).toBeInTheDocument();
  });

  it("stops polling once a terminal status is reached", async () => {
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="completed"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(pollOrderStatusMock).not.toHaveBeenCalled();
  });

  it("treats a null poll result (token no longer resolvable, e.g. tenant/slug mismatch) as a no-op rather than clearing the status", async () => {
    pollOrderStatusMock.mockResolvedValue(null);
    render(
      <OrderStatusLive
        tenantSlug="demo"
        token="raw-token"
        initialStatus="received"
        orderId="11112222-3333-4444-5555-666677778888"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByText("Bestellung eingegangen")).toBeInTheDocument();
  });
});

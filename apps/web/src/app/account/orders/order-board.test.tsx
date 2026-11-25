import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transitionOrderStatusAction = vi.hoisted(() => vi.fn());
const pollTenantOrders = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ transitionOrderStatusAction, pollTenantOrders }));

import { OrderBoard } from "./order-board";
import type { TenantOrderRow } from "@/lib/orders/dashboard-service";

const ORDER: TenantOrderRow = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "received",
  fulfillmentType: "pickup",
  customerName: "Erika Muster",
  tableIdentifier: null,
  totalCents: 1850,
  currency: "EUR",
  createdAt: "2026-11-01T10:00:00.000Z",
  paymentStatus: "paid",
};

describe("OrderBoard", () => {
  beforeEach(() => {
    transitionOrderStatusAction.mockReset();
    pollTenantOrders.mockReset();
    pollTenantOrders.mockResolvedValue(null);
  });

  it("links every order card to its detail and refund page, also without orders.manage", () => {
    render(<OrderBoard initialOrders={[ORDER]} initialHasMore={false} canManageOrders={false} />);

    const link = screen.getByRole("link", { name: /Details und Erstattung/ });
    expect(link).toHaveAttribute("href", `/account/orders/${ORDER.id}`);
    expect(link).toHaveTextContent("Details und Erstattung");
  });

  it("shows the server's German error text and disables only the pending order's buttons", async () => {
    let resolveAction: (value: { error: string }) => void = () => {};
    transitionOrderStatusAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<OrderBoard initialOrders={[ORDER]} initialHasMore={false} canManageOrders />);

    const button = screen.getAllByRole("button", { name: /Bestellung von Erika Muster/ })[0]!;
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    resolveAction({ error: "Der Bestellstatus konnte nicht geändert werden." });
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geändert");
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("falls back to a German message when the action throws", async () => {
    transitionOrderStatusAction.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    render(<OrderBoard initialOrders={[ORDER]} initialHasMore={false} canManageOrders />);

    fireEvent.click(screen.getAllByRole("button", { name: /Bestellung von Erika Muster/ })[0]!);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte versuchen Sie es erneut");
    expect(alert).not.toHaveTextContent("ECONNRESET");
  });
});

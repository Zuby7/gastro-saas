import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const issueRefundAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ issueRefundAction }));

import { RefundForm } from "./refund-form";

describe("RefundForm keeps input after an error", () => {
  it("keeps amount and reason when the server returns a validation error", async () => {
    issueRefundAction.mockResolvedValue({
      error: "Rückerstattung abgelehnt.",
      fieldErrors: { amountCents: "Zu hoch." },
    });
    render(<RefundForm orderId="order-1" remainingRefundableCents={1000} />);

    const amount = screen.getByLabelText(/Betrag/);
    fireEvent.change(amount, { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Grund (erforderlich)"), {
      target: { value: "Falsche Lieferung" },
    });
    const submit = screen.getByRole("button", { name: "Rückerstattung auslösen" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(issueRefundAction).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Betrag/)).toHaveValue("5000");
    expect(screen.getByLabelText("Grund (erforderlich)")).toHaveValue("Falsche Lieferung");
  });
});

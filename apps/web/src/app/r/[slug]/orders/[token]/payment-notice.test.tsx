import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentNotice } from "./payment-notice";

const retryPaymentActionMock = vi.fn();

vi.mock("./actions", () => ({
  retryPaymentAction: (...args: unknown[]) => retryPaymentActionMock(...args),
}));

beforeEach(() => {
  retryPaymentActionMock.mockReset();
});

describe("PaymentNotice", () => {
  it("explains a cancelled payment and offers 'Erneut bezahlen' (no guest cancel path)", () => {
    render(<PaymentNotice tenantSlug="demo" token="raw-token" checkout="cancelled" />);

    expect(screen.getByText("Zahlung abgebrochen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut bezahlen" })).toHaveClass("min-h-11");
    expect(screen.queryByRole("button", { name: /stornieren/i })).toBeNull();
  });

  it("binds tenant slug and token server-side and submits no client-supplied amount", async () => {
    retryPaymentActionMock.mockResolvedValue({});
    render(<PaymentNotice tenantSlug="demo" token="raw-token" checkout="cancelled" />);

    fireEvent.click(screen.getByRole("button", { name: "Erneut bezahlen" }));

    await waitFor(() => expect(retryPaymentActionMock).toHaveBeenCalled());
    const [slug, token, , formData] = retryPaymentActionMock.mock.calls[0] as [
      string,
      string,
      unknown,
      FormData,
    ];
    expect(slug).toBe("demo");
    expect(token).toBe("raw-token");
    expect(Array.from(formData.keys())).toEqual([]);
  });

  it("shows the action's error message", async () => {
    retryPaymentActionMock.mockResolvedValue({
      error: "Die Zahlung konnte nicht gestartet werden.",
    });
    render(<PaymentNotice tenantSlug="demo" token="raw-token" checkout="cancelled" />);

    fireEvent.click(screen.getByRole("button", { name: "Erneut bezahlen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Zahlung konnte nicht gestartet werden.",
    );
  });

  it("shows a 'Zahlung wird bestätigt' note after the success return while still awaiting", () => {
    render(<PaymentNotice tenantSlug="demo" token="raw-token" checkout="success" />);

    expect(screen.getByRole("status")).toHaveTextContent("Zahlung wird bestätigt");
    expect(screen.queryByRole("button", { name: "Erneut bezahlen" })).toBeNull();
  });
});

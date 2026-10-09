import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "./checkout-form";

const checkoutAction = vi.hoisted(() => vi.fn());

vi.mock("./actions", () => ({ checkoutAction }));

const PHONE_LABEL = "Telefonnummer (optional, für Rückfragen zur Abholung)";

describe("CheckoutForm keeps user input after a validation error", () => {
  beforeEach(() => {
    checkoutAction.mockReset();
    checkoutAction.mockResolvedValue({ error: "Bitte stimmen Sie den AGB zu." });
  });

  it("keeps name, phone and note when the server rejects the missing AGB consent", async () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Erika Muster" } });
    fireEvent.change(screen.getByLabelText(PHONE_LABEL), { target: { value: "0171 1234567" } });
    fireEvent.change(screen.getByLabelText("Hinweis (optional)"), {
      target: { value: "Ohne Zwiebeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter zur Zahlung" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AGB");
    expect(screen.getByLabelText("Name")).toHaveValue("Erika Muster");
    expect(screen.getByLabelText(PHONE_LABEL)).toHaveValue("0171 1234567");
    expect(screen.getByLabelText("Hinweis (optional)")).toHaveValue("Ohne Zwiebeln");
    expect(screen.getByRole("radio", { name: "Online bestellen & abholen" })).toBeChecked();
  });

  it("keeps the table choice, table number and the ticked consent after an error", async () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    fireEvent.click(screen.getByRole("radio", { name: "Am Tisch bestellen" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Max" } });
    fireEvent.change(screen.getByLabelText("Tischnummer"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter zur Zahlung" }));

    await waitFor(() => expect(checkoutAction).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    expect(screen.getByRole("radio", { name: "Am Tisch bestellen" })).toBeChecked();
    expect(screen.getByLabelText("Tischnummer")).toHaveValue("12");
    expect(screen.getByLabelText("Name")).toHaveValue("Max");
  });

  it("submits the entered values to the action", async () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Erika" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter zur Zahlung" }));

    await waitFor(() => expect(checkoutAction).toHaveBeenCalledTimes(1));
    const formData = checkoutAction.mock.calls[0]![2] as FormData;
    expect(formData.get("customerName")).toBe("Erika");
  });
});

describe("CheckoutForm payment-methods hint", () => {
  it("does not claim PayPal and mentions further payment methods", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    expect(screen.queryByText(/PayPal/i)).not.toBeInTheDocument();
    expect(screen.getByText("Kreditkarte")).toBeInTheDocument();
    expect(screen.getByText("Klarna")).toBeInTheDocument();
    expect(screen.getByText("weitere Zahlarten")).toBeInTheDocument();
  });

  it("renders a form with a function action (never a bare GET form)", () => {
    const { container } = render(<CheckoutForm tenantSlug="demo" checkoutReady />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toMatch(/^javascript:/);
    expect(form.getAttribute("method")?.toLowerCase() ?? "post").not.toBe("get");
  });
});

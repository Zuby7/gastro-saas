import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "./checkout-form";

vi.mock("./actions", () => ({
  checkoutAction: async () => ({}),
}));

/**
 * Semantic-structure a11y coverage for `CheckoutForm` (Epic 6, ticket #21) --
 * added as part of the epic-6 batch review's finding 2. Covers both
 * fulfillment-type variants (pickup/table) and the "cart not checkout-ready"
 * blocked state.
 */
describe("CheckoutForm accessibility", () => {
  it("groups the fulfillment-type choice under a labeled fieldset/legend", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    expect(screen.getByRole("group", { name: "Sie sitzen im Restaurant?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Online bestellen & abholen" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Am Tisch bestellen" })).not.toBeChecked();
  });

  // Ticket #152: online-first flow -- the table-ordering choice is no longer
  // the first question.
  it("renders name, phone and note before the fulfillment fieldset, and the table number after it", () => {
    const { container } = render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    const name = container.querySelector("#customerName")!;
    const phone = container.querySelector("#customerPhone")!;
    const note = container.querySelector("#customerNote")!;
    const fieldset = container.querySelector("fieldset")!;
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;

    expect(name.compareDocumentPosition(fieldset) & follows).toBeTruthy();
    expect(phone.compareDocumentPosition(fieldset) & follows).toBeTruthy();
    expect(note.compareDocumentPosition(fieldset) & follows).toBeTruthy();
    expect(container.querySelector("form")!.firstElementChild).not.toBe(fieldset);

    fireEvent.click(screen.getByRole("radio", { name: "Am Tisch bestellen" }));
    const table = container.querySelector("#tableIdentifier")!;
    expect(fieldset.compareDocumentPosition(table) & follows).toBeTruthy();
  });

  it("shows the phone field (optional) for the pickup variant by default, with a labeled input", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    expect(
      screen.getByLabelText("Telefonnummer (optional, für Rückfragen zur Abholung)"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Tischnummer")).not.toBeInTheDocument();
  });

  it("switches to a required, labeled table-number field for the table variant", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    fireEvent.click(screen.getByRole("radio", { name: "Am Tisch bestellen" }));

    const tableInput = screen.getByLabelText("Tischnummer");
    expect(tableInput).toBeRequired();
    expect(
      screen.queryByLabelText("Telefonnummer (optional, für Rückfragen zur Abholung)"),
    ).not.toBeInTheDocument();
  });

  it("labels the required customer-name field", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("announces the blocked-cart state via role=alert, disables submission, and never hides the reason behind color alone", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady={false} />);

    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((alert) => alert.textContent?.includes("nicht mehr verfügbare Artikel")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Weiter zur Zahlung" })).toBeDisabled();
  });

  // Ticket #41: privacy notice with a link to the full Datenschutzerklärung,
  // shown before the order can be submitted.
  it("shows a privacy notice linking to the tenant's Datenschutzerklärung before submission", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    const links = screen.getAllByRole("link", { name: "Datenschutzerklärung" });
    expect(links.some((link) => link.getAttribute("href") === "/r/demo/datenschutz")).toBe(true);
  });

  // Ticket #146: required, labeled consent checkbox linking to both the
  // tenant's AGB (incl. Widerrufsrecht) and Datenschutzerklärung.
  it("requires an explicit AGB/Datenschutz consent checkbox before submission, linking to both pages", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);

    const checkbox = screen.getByRole("checkbox", { name: /AGB.*Datenschutzerklärung/ });
    expect(checkbox).toBeRequired();
    expect(checkbox).not.toBeChecked();

    const agbLink = screen.getByRole("link", { name: "AGB" });
    expect(agbLink).toHaveAttribute("href", "/r/demo/agb");
  });
});

describe("CheckoutForm payment method (issue #195)", () => {
  it("does not render the payment method choice when PayPal is not available", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady />);
    expect(screen.queryByRole("group", { name: "Zahlungsart" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "PayPal" })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="paymentMethod"]')).toBeNull();
  });

  it("renders a labeled radio group with Stripe as the default when PayPal is available", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady paypalAvailable />);

    expect(screen.getByRole("group", { name: "Zahlungsart" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Karte, Klarna, Apple Pay und weitere" }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: "PayPal" })).not.toBeChecked();
  });

  it("switches to PayPal and submits the chosen value", () => {
    render(<CheckoutForm tenantSlug="demo" checkoutReady paypalAvailable />);

    fireEvent.click(screen.getByRole("radio", { name: "PayPal" }));
    expect(screen.getByRole("radio", { name: "PayPal" })).toBeChecked();
    const form = document.querySelector("form")!;
    expect(new FormData(form).get("paymentMethod")).toBe("paypal");
    expect(screen.getByText(/Sichere Zahlung über PayPal/)).toBeInTheDocument();
  });
});

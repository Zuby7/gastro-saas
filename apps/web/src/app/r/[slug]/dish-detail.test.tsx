import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { DishOptionChooser, SimpleAddButton } from "./dish-detail";

const addToCartActionMock = vi.fn();

vi.mock("./cart/actions", () => ({
  addToCartAction: (...args: unknown[]) => addToCartActionMock(...args),
}));

const cartResult = (itemCount: number) => ({
  cart: {
    cartId: "cart-1",
    currency: "EUR",
    items: [],
    totalCents: 0,
    itemCount,
    hasUnavailableItems: false,
    checkoutReady: true,
  },
});

const simpleDish: PublicMenuDish = {
  id: "dish-1",
  name: "Cola",
  description: "",
  priceCents: 350,
  currency: "EUR",
  soldOut: false,
  image: null,
  variants: [{ id: "variant-1", name: "0,33 l", priceCents: 350, currency: "EUR" }],
  optionGroups: [],
  labels: [],
  allergenNotice: "",
};

const chooserDish: PublicMenuDish = {
  id: "dish-2",
  name: "Burger",
  description: "",
  priceCents: 900,
  currency: "EUR",
  soldOut: false,
  image: null,
  variants: [],
  optionGroups: [
    {
      id: "group-1",
      name: "Extras",
      minSelections: 0,
      maxSelections: 2,
      options: [
        { id: "opt-cheese", name: "Käse", priceDeltaCents: 100, currency: "EUR" },
        { id: "opt-bacon", name: "Speck", priceDeltaCents: 150, currency: "EUR" },
      ],
    },
  ],
  labels: [],
  allergenNotice: "",
};

beforeEach(() => {
  addToCartActionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SimpleAddButton confirmation", () => {
  it("never covers the add button, auto-dismisses after ~3 s and keeps the cart link reachable meanwhile", async () => {
    vi.useFakeTimers();
    addToCartActionMock.mockResolvedValue(cartResult(1));
    render(<SimpleAddButton dish={simpleDish} tenantSlug="demo" />);

    const addButton = screen.getByRole("button", { name: "Cola zum Warenkorb hinzufügen" });
    await act(async () => {
      fireEvent.click(addButton);
    });

    const link = screen.getByRole("link", { name: "Warenkorb ansehen" });
    expect(link).toHaveAttribute("href", "/r/demo/cart");
    // The message floats above the row instead of overlaying it.
    const message = link.closest("div");
    expect(message).not.toHaveClass("inset-0");
    expect(message).toHaveClass("bottom-full");
    // The add button stays enabled and usable while the message is visible.
    expect(addButton).not.toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.queryByRole("link", { name: "Warenkorb ansehen" })).toBeNull();
  });

  it("can be dismissed manually", async () => {
    addToCartActionMock.mockResolvedValue(cartResult(1));
    render(<SimpleAddButton dish={simpleDish} tenantSlug="demo" />);

    fireEvent.click(screen.getByRole("button", { name: "Cola zum Warenkorb hinzufügen" }));
    await screen.findByRole("link", { name: "Warenkorb ansehen" });

    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByRole("link", { name: "Warenkorb ansehen" })).toBeNull();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("DishOptionChooser selection state after a successful add", () => {
  it("clears the ticked extras, the preview price and the submitted optionIds together", async () => {
    addToCartActionMock.mockResolvedValue(cartResult(1));
    const { container } = render(<DishOptionChooser dish={chooserDish} tenantSlug="demo" />);

    const cheese = screen.getByRole("checkbox", { name: /Käse/ });
    fireEvent.click(cheese);
    expect(cheese).toBeChecked();
    expect(screen.getByText("10,00 €")).toBeInTheDocument();
    const optionIds = () =>
      (container.querySelector('input[name="optionIds"]') as HTMLInputElement).value;
    expect(optionIds()).toBe(JSON.stringify(["opt-cheese"]));

    fireEvent.click(screen.getByRole("button", { name: "In den Warenkorb" }));

    await waitFor(() => expect(addToCartActionMock).toHaveBeenCalledTimes(1));
    const [, , formData] = addToCartActionMock.mock.calls[0] as [string, unknown, FormData];
    expect(formData.get("optionIds")).toBe(JSON.stringify(["opt-cheese"]));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Käse/ })).not.toBeChecked());
    expect(screen.getByText("9,00 €")).toBeInTheDocument();
    expect(optionIds()).toBe("[]");

    // A second add submits exactly what is visibly ticked: no extras.
    fireEvent.click(screen.getByRole("button", { name: "In den Warenkorb" }));
    await waitFor(() => expect(addToCartActionMock).toHaveBeenCalledTimes(2));
    const [, , secondFormData] = addToCartActionMock.mock.calls[1] as [string, unknown, FormData];
    expect(secondFormData.get("optionIds")).toBe("[]");
  });

  it("keeps the selection when the add fails", async () => {
    addToCartActionMock.mockResolvedValue({ error: "Nicht verfügbar." });
    render(<DishOptionChooser dish={chooserDish} tenantSlug="demo" />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Käse/ }));
    fireEvent.click(screen.getByRole("button", { name: "In den Warenkorb" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("checkbox", { name: /Käse/ })).toBeChecked();
  });

  it("gives checkboxes and their labels at least a 44 px tap target", () => {
    render(<DishOptionChooser dish={chooserDish} tenantSlug="demo" />);
    expect(screen.getByRole("checkbox", { name: /Käse/ }).closest("label")).toHaveClass("min-h-11");
  });
});

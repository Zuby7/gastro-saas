import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvailabilityToggleForm } from "./availability-toggle-form";

const noopAction = async () => ({});

/**
 * Epic 8 Opus batch review, finding 5: the badge/hidden-isAvailable field
 * must be derived from *effective* availability (mirroring
 * `is_menu_item_available()`), not the raw `isAvailable` column alone.
 * Finding 10: the submit button's touch target/focus-visible treatment must
 * match the epic's `min-h-12`/`focus-visible:outline` standard.
 */
describe("AvailabilityToggleForm effective availability derivation", () => {
  it("shows 'Ausverkauft' and targets isAvailable=true when isAvailable is false with no schedule", () => {
    const { getByText, container } = render(
      <AvailabilityToggleForm
        action={noopAction}
        hiddenFields={{ dishId: "dish-1" }}
        isAvailable={false}
        availableAgainAt={null}
        idPrefix="dish-1"
        itemLabel="Margherita"
      />,
    );

    expect(getByText("Ausverkauft")).toBeInTheDocument();
    const hiddenInput = container.querySelector('input[name="isAvailable"]') as HTMLInputElement;
    expect(hiddenInput.value).toBe("true");
  });

  it("shows 'Verfügbar' (not 'Ausverkauft') once availableAgainAt has already passed, even though isAvailable is still false", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { getByText, queryByText, container } = render(
      <AvailabilityToggleForm
        action={noopAction}
        hiddenFields={{ dishId: "dish-1" }}
        isAvailable={false}
        availableAgainAt={past}
        idPrefix="dish-1"
        itemLabel="Margherita"
      />,
    );

    expect(getByText("Verfügbar")).toBeInTheDocument();
    expect(queryByText("Ausverkauft")).toBeNull();
    // Effectively available -> clicking should target "mark as sold out",
    // i.e. the next isAvailable value is false.
    const hiddenInput = container.querySelector('input[name="isAvailable"]') as HTMLInputElement;
    expect(hiddenInput.value).toBe("false");
  });

  it("still shows 'Ausverkauft' when availableAgainAt is in the future", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { getByText } = render(
      <AvailabilityToggleForm
        action={noopAction}
        hiddenFields={{ dishId: "dish-1" }}
        isAvailable={false}
        availableAgainAt={future}
        idPrefix="dish-1"
        itemLabel="Margherita"
      />,
    );

    expect(getByText("Ausverkauft")).toBeInTheDocument();
  });

  it("applies the min-h-12 touch target and focus-visible:outline classes to the submit button", () => {
    const { getByRole } = render(
      <AvailabilityToggleForm
        action={noopAction}
        hiddenFields={{ dishId: "dish-1" }}
        isAvailable={true}
        availableAgainAt={null}
        idPrefix="dish-1"
        itemLabel="Margherita"
      />,
    );

    const button = getByRole("button");
    expect(button).toHaveClass("min-h-12");
    expect(button).toHaveClass("focus-visible:outline");
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PLATFORM_COOKIES } from "@/lib/consent/inventory";
import PlatformDatenschutzPage from "./page";

describe("platform Datenschutz page cookie section", () => {
  it("renders the cookie section with the platform cookies only", () => {
    render(<PlatformDatenschutzPage />);

    const heading = screen.getByRole("heading", { name: "Cookies und ähnliche Technologien" });
    expect(heading).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Cookies der Plattform-Seiten" });
    const rows = within(region).getAllByRole("row");
    expect(rows).toHaveLength(PLATFORM_COOKIES.length + 1);
    expect(within(region).getByText("sb-*")).toBeInTheDocument();
    expect(within(region).queryByText(/gastro_view_/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/gastro_cart_/)).not.toBeInTheDocument();
  });
});

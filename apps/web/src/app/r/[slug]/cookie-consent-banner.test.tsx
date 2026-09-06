import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieConsentBanner } from "./cookie-consent-banner";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function clearAllCookies() {
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
});

/**
 * Ticket #146: consent banner for the non-essential `menu_view` analytics
 * cookie. Kept deliberately minimal (accept/decline only).
 */
describe("CookieConsentBanner", () => {
  it("shows the banner with a labeled region, accept/decline buttons, and a privacy-policy link when no decision has been made", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);

    expect(screen.getByRole("region", { name: "Cookie-Einstellungen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Akzeptieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ablehnen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute(
      "href",
      "/r/demo/datenschutz",
    );
  });

  it("does not render if a consent decision cookie already exists", () => {
    document.cookie = "gastro_cookie_consent=accepted; path=/";

    render(<CookieConsentBanner tenantSlug="demo" />);

    expect(screen.queryByRole("region", { name: "Cookie-Einstellungen" })).not.toBeInTheDocument();
  });

  it("writes an 'accepted' consent cookie, hides the banner, and refreshes on accept", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);

    fireEvent.click(screen.getByRole("button", { name: "Akzeptieren" }));

    expect(document.cookie).toContain("gastro_cookie_consent=accepted");
    expect(screen.queryByRole("region", { name: "Cookie-Einstellungen" })).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("writes a 'declined' consent cookie, hides the banner, and refreshes on decline", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);

    fireEvent.click(screen.getByRole("button", { name: "Ablehnen" }));

    expect(document.cookie).toContain("gastro_cookie_consent=declined");
    expect(screen.queryByRole("region", { name: "Cookie-Einstellungen" })).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});

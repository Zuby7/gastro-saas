import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_COOKIE_NAME,
  CONSENT_VALIDITY_SECONDS,
  CONSENT_VERSION,
  parseConsent,
  serializeConsent,
} from "@/lib/consent/cookie";
import { COOKIE_INVENTORY } from "@/lib/consent/inventory";
import { CONSENT_BUTTON_CLASS, CookieConsentBanner } from "./cookie-consent-banner";

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

function storedConsent() {
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE_NAME}=`));
  return parseConsent(entry?.slice(CONSENT_COOKIE_NAME.length + 1));
}

function setConsentCookie(raw: string) {
  document.cookie = `${CONSENT_COOKIE_NAME}=${raw}; path=/`;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
});

const banner = () => screen.queryByRole("region", { name: "Cookie-Hinweis" });

describe("CookieConsentBanner first level", () => {
  it("shows three equal buttons, a privacy link, and sets no cookie before a decision", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);

    const region = screen.getByRole("region", { name: "Cookie-Hinweis" });
    expect(within(region).getByRole("button", { name: "Alle ablehnen" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Einstellungen" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Alle akzeptieren" })).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute(
      "href",
      "/r/demo/datenschutz",
    );
    // No non-essential (and no consent) cookie is written merely by showing the banner.
    expect(document.cookie).toBe("");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("gives reject, settings and accept exactly the same classes (no dark pattern)", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);

    const region = screen.getByRole("region", { name: "Cookie-Hinweis" });
    for (const name of ["Alle ablehnen", "Einstellungen", "Alle akzeptieren"]) {
      expect(within(region).getByRole("button", { name }).className).toBe(CONSENT_BUTTON_CLASS);
    }
  });

  it("does not render the banner if a valid decision exists", () => {
    setConsentCookie(serializeConsent(false));
    render(<CookieConsentBanner tenantSlug="demo" />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("re-prompts for legacy accepted/declined values", () => {
    for (const legacy of ["accepted", "declined"]) {
      setConsentCookie(legacy);
      const { unmount } = render(<CookieConsentBanner tenantSlug="demo" />);
      expect(banner()).toBeInTheDocument();
      unmount();
    }
  });

  it("re-prompts when the stored version differs", () => {
    setConsentCookie(
      encodeURIComponent(
        JSON.stringify({
          version: CONSENT_VERSION - 1,
          timestamp: new Date().toISOString(),
          statistics: true,
        }),
      ),
    );
    render(<CookieConsentBanner tenantSlug="demo" />);
    expect(banner()).toBeInTheDocument();
  });

  it("re-prompts when the decision is older than 6 months", () => {
    const old = new Date(Date.now() - (CONSENT_VALIDITY_SECONDS + 3600) * 1000);
    setConsentCookie(serializeConsent(true, old));
    render(<CookieConsentBanner tenantSlug="demo" />);
    expect(banner()).toBeInTheDocument();
  });

  it("'Alle ablehnen' stores a versioned decision with statistics=false and refreshes", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Alle ablehnen" }));

    const state = storedConsent();
    expect(state.status).toBe("valid");
    if (state.status === "valid") {
      expect(state.record.statistics).toBe(false);
      expect(state.record.version).toBe(CONSENT_VERSION);
      expect(Number.isNaN(Date.parse(state.record.timestamp))).toBe(false);
    }
    expect(banner()).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("'Alle akzeptieren' stores statistics=true", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Alle akzeptieren" }));

    const state = storedConsent();
    expect(state.status === "valid" && state.record.statistics).toBe(true);
    expect(banner()).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});

describe("CookieConsentBanner settings dialog", () => {
  it("opens an accessible modal dialog with both categories, tables, and statistics off by default", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));

    const dialog = screen.getByRole("dialog", { name: "Cookie-Einstellungen" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "Notwendig" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Statistik" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Statistik erlauben" })).not.toBeChecked();
    expect(within(dialog).getAllByRole("columnheader", { name: "Name" })).toHaveLength(2);
    for (const header of ["Zweck", "Dauer", "Anbieter"]) {
      expect(within(dialog).getAllByRole("columnheader", { name: header })).toHaveLength(2);
    }
    for (const entry of COOKIE_INVENTORY) {
      expect(within(dialog).getByText(entry.name)).toBeInTheDocument();
    }
    // Nothing is stored just by opening the dialog.
    expect(document.cookie).toBe("");
  });

  it("saves the selection: statistics opt-in via checkbox", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Statistik erlauben" }));
    fireEvent.click(screen.getByRole("button", { name: "Auswahl speichern" }));

    const state = storedConsent();
    expect(state.status === "valid" && state.record.statistics).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("saving without ticking statistics stores statistics=false", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    fireEvent.click(screen.getByRole("button", { name: "Auswahl speichern" }));

    const state = storedConsent();
    expect(state.status === "valid" && state.record.statistics).toBe(false);
  });

  it("dialog buttons reject/save/accept share the same classes", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    const dialog = screen.getByRole("dialog");
    for (const name of ["Alle ablehnen", "Auswahl speichern", "Alle akzeptieren"]) {
      expect(within(dialog).getByRole("button", { name }).className).toBe(CONSENT_BUTTON_CLASS);
    }
  });

  it("ESC closes the dialog without storing a decision and returns focus to the trigger", async () => {
    vi.useFakeTimers();
    try {
      render(<CookieConsentBanner tenantSlug="demo" />);
      const trigger = screen.getByRole("button", { name: "Einstellungen" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      await act(async () => {
        vi.runAllTimers();
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.cookie).toBe("");
      expect(banner()).toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it("traps Tab / Shift+Tab inside the dialog", () => {
    render(<CookieConsentBanner tenantSlug="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    const dialog = screen.getByRole("dialog");
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled])",
      ),
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe("persistent Cookie-Einstellungen link and withdrawal", () => {
  it("is present even after a decision and reopens the dialog with the stored choice", async () => {
    vi.useFakeTimers();
    try {
      setConsentCookie(serializeConsent(true));
      render(<CookieConsentBanner tenantSlug="demo" />);
      expect(banner()).not.toBeInTheDocument();

      const link = screen.getByRole("button", { name: "Cookie-Einstellungen" });
      link.focus();
      fireEvent.click(link);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("checkbox", { name: "Statistik erlauben" })).toBeChecked();

      fireEvent.keyDown(dialog, { key: "Escape" });
      await act(async () => {
        vi.runAllTimers();
      });
      expect(link).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it("withdrawal stores statistics=false and refreshes so middleware deletes menu_view", () => {
    setConsentCookie(serializeConsent(true));
    render(<CookieConsentBanner tenantSlug="demo" />);

    fireEvent.click(screen.getByRole("button", { name: "Cookie-Einstellungen" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Statistik erlauben" }));
    fireEvent.click(screen.getByRole("button", { name: "Auswahl speichern" }));

    const state = storedConsent();
    expect(state.status === "valid" && state.record.statistics).toBe(false);
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});

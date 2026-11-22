import { afterEach, describe, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "./email";

const input = {
  to: "invitee@example.com",
  inviteUrl: "https://app.example.com/invite/secret-token-value",
  tenantName: "Pizzeria Napoli",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendInvitationEmail", () => {
  // Issue #204 (audit 2026-11): neither the invitee's address nor the
  // single-use invite URL may end up in the logs.
  it("logs neither the invitee address nor the invite URL when no API key is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logged: unknown[][] = [];
    for (const method of ["info", "log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }

    await sendInvitationEmail(input);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("invitee@example.com");
    expect(serialized).not.toContain("secret-token-value");
  });

  it("sends the mail through Resend when an API key is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendInvitationEmail(input);

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(body.to).toBe("invitee@example.com");
    expect(body.text).toContain(input.inviteUrl);
  });

  it("throws when Resend rejects the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(sendInvitationEmail(input)).rejects.toThrow("Invitation email could not be sent.");
  });
});

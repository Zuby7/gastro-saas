import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const handleMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/payments/mollie-webhook-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mollie-webhook-service")>();
  return { ...actual, handleMolliePaymentWebhook: (...args: unknown[]) => handleMock(...args) };
});

import { POST } from "./route";

function request(body: string, contentType = "application/x-www-form-urlencoded") {
  return new NextRequest("http://localhost/api/webhooks/mollie", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
  });
}

describe("POST /api/webhooks/mollie", () => {
  beforeEach(() => {
    handleMock.mockReset();
  });

  it("passes the form id to the verifying handler and answers 200", async () => {
    handleMock.mockResolvedValue(undefined);
    const response = await POST(request("id=tr_abc123"));
    expect(response.status).toBe(200);
    expect(handleMock).toHaveBeenCalledWith(expect.anything(), "tr_abc123");
  });

  it("answers a neutral 200 for malformed ids without calling the handler", async () => {
    for (const body of [
      "id=",
      "id=pi_123",
      "id=tr_abc/../x",
      "foo=bar",
      "id=" + "tr_" + "a".repeat(200),
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    }
    expect(handleMock).not.toHaveBeenCalled();
  });

  it("answers a neutral 200 for a non-form body", async () => {
    const response = await POST(request("{not form", "application/json"));
    expect(response.status).toBe(200);
    expect(handleMock).not.toHaveBeenCalled();
  });

  it("answers the same body for unknown ids (handler is silent) as for processed ones", async () => {
    handleMock.mockResolvedValue(undefined);
    const response = await POST(request("id=tr_unknown1"));
    expect(await response.json()).toEqual({ received: true });
  });

  it("answers 5xx on unexpected errors so Mollie retries, without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handleMock.mockImplementation(async () => {
      throw new Error("secret db detail");
    });
    const response = await POST(request("id=tr_abc123"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret");
  });
});

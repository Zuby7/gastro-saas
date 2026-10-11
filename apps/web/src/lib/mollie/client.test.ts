import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MollieApiError,
  buildMollieAuthorizeUrl,
  centsToMollieValue,
  createMollieRefund,
  createMolliePayment,
  exchangeMollieAuthorizationCode,
  getMolliePayment,
  isMollieTestMode,
  isMolliePaypalEnabled,
  mollieValueToCents,
  refreshMollieAccessToken,
} from "./client";

const fetchMock = vi.fn();
const callAt = (index: number) =>
  fetchMock.mock.calls[index] as unknown as [
    string,
    { headers: Record<string, string>; body: string },
  ];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mollie client", () => {
  beforeEach(() => {
    vi.stubEnv("MOLLIE_CLIENT_ID", "app_test_id");
    vi.stubEnv("MOLLIE_CLIENT_SECRET", "test_client_secret");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("amount helpers", () => {
    it("formats cents without floats", () => {
      expect(centsToMollieValue(1234)).toBe("12.34");
      expect(centsToMollieValue(5)).toBe("0.05");
      expect(centsToMollieValue(1000)).toBe("10.00");
    });
    it("rejects non-positive or fractional cents", () => {
      expect(() => centsToMollieValue(0)).toThrow();
      expect(() => centsToMollieValue(-1)).toThrow();
      expect(() => centsToMollieValue(1.5)).toThrow();
    });
    it("parses Mollie values back to cents and rejects malformed ones", () => {
      expect(mollieValueToCents("12.34")).toBe(1234);
      expect(mollieValueToCents("12.3")).toBeNull();
      expect(mollieValueToCents(12.34)).toBeNull();
    });
  });

  describe("live gate", () => {
    it("is test mode unless MOLLIE_LIVE_ALLOWED is exactly '1'", () => {
      expect(isMollieTestMode()).toBe(true);
      vi.stubEnv("MOLLIE_LIVE_ALLOWED", "true");
      expect(isMollieTestMode()).toBe(true);
      vi.stubEnv("MOLLIE_LIVE_ALLOWED", "0");
      expect(isMollieTestMode()).toBe(true);
      vi.stubEnv("MOLLIE_LIVE_ALLOWED", "1");
      expect(isMollieTestMode()).toBe(false);
    });

    it("sends testmode:true on payments by default and omits it only when live is allowed", async () => {
      // A fresh Response per call (a body can only be read once).
      fetchMock.mockImplementation(async () =>
        jsonResponse({ id: "tr_1", status: "open", _links: { checkout: { href: "https://x" } } }),
      );
      const params = {
        amountCents: 1234,
        description: "Bestellung",
        redirectUrl: "https://app/r/x/orders/t",
        webhookUrl: "https://app/api/webhooks/mollie",
        orderId: "order-1",
        tenantId: "tenant-1",
        idempotencyKey: "mollie-payment:order-1",
      };
      await createMolliePayment("access", "pfl_1", params);
      expect(JSON.parse(callAt(0)[1].body).testmode).toBe(true);

      vi.stubEnv("MOLLIE_LIVE_ALLOWED", "1");
      await createMolliePayment("access", "pfl_1", params);
      expect(JSON.parse(callAt(1)[1].body).testmode).toBeUndefined();
    });
  });

  it("builds the authorize URL with state, redirect and scopes", () => {
    const url = new URL(buildMollieAuthorizeUrl({ redirectUri: "https://app/cb", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://my.mollie.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("app_test_id");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("payments.write");
    expect(url.search).not.toContain("test_client_secret");
  });

  it("fails closed without OAuth credentials", () => {
    vi.stubEnv("MOLLIE_CLIENT_SECRET", "");
    expect(() => buildMollieAuthorizeUrl({ redirectUri: "x", state: "y" })).toThrow(
      /MOLLIE_CLIENT_ID/,
    );
  });

  it("exchanges an authorization code using Basic client auth", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
    );
    const tokens = await exchangeMollieAuthorizationCode({ code: "c", redirectUri: "https://cb" });
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresInSeconds: 3600 });
    const [url, init] = callAt(0);
    expect(url).toBe("https://api.mollie.com/oauth2/tokens");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("app_test_id:test_client_secret")}`);
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c");
    expect(body.get("redirect_uri")).toBe("https://cb");
  });

  it("refreshes tokens with the refresh_token grant", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: "a2", refresh_token: "r2", expires_in: 100 }),
    );
    await refreshMollieAccessToken("old_refresh");
    const body = new URLSearchParams(callAt(0)[1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old_refresh");
  });

  it("does not leak the response body or secrets in token errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_grant", secret: "leak" }, 400));
    const error = await refreshMollieAccessToken("r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MollieApiError);
    expect((error as MollieApiError).isDefinitive).toBe(true);
    expect((error as Error).message).not.toContain("leak");
    expect((error as Error).message).not.toContain("test_client_secret");
  });

  it("creates a payment with server total, EUR, paypal, metadata and Idempotency-Key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "tr_abc",
        status: "open",
        _links: { checkout: { href: "https://www.mollie.com/checkout/x" } },
      }),
    );
    const payment = await createMolliePayment("tok", "pfl_9", {
      amountCents: 1234,
      description: "Bestellung ABC",
      redirectUrl: "https://app/r/demo/orders/tok",
      webhookUrl: "https://app/api/webhooks/mollie",
      orderId: "order-1",
      tenantId: "tenant-1",
      idempotencyKey: "mollie-payment:order-1",
    });
    expect(payment.checkoutUrl).toBe("https://www.mollie.com/checkout/x");
    const [url, init] = callAt(0);
    expect(url).toBe("https://api.mollie.com/v2/payments");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["Idempotency-Key"]).toBe("mollie-payment:order-1");
    expect(JSON.parse(init.body)).toEqual({
      amount: { currency: "EUR", value: "12.34" },
      description: "Bestellung ABC",
      redirectUrl: "https://app/r/demo/orders/tok",
      webhookUrl: "https://app/api/webhooks/mollie",
      method: ["paypal"],
      metadata: { orderId: "order-1", tenantId: "tenant-1" },
      profileId: "pfl_9",
      testmode: true,
    });
  });

  it("gets a payment (testmode query) and parses amount/metadata", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "tr_abc",
        status: "paid",
        amount: { value: "12.34", currency: "EUR" },
        method: "paypal",
        mode: "test",
        profileId: "pfl_9",
        metadata: { orderId: "o", tenantId: "t" },
      }),
    );
    const payment = await getMolliePayment("tok", "tr_abc");
    expect(callAt(0)[0]).toBe("https://api.mollie.com/v2/payments/tr_abc?testmode=true");
    expect(payment).toMatchObject({
      id: "tr_abc",
      status: "paid",
      amountCents: 1234,
      currency: "EUR",
      method: "paypal",
      mode: "test",
      metadata: { orderId: "o", tenantId: "t" },
    });
  });

  it("throws a definitive error for 4xx and an ambiguous one for network/5xx failures", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 422));
    const client = await getMolliePayment("t", "tr_x").catch((e: unknown) => e);
    expect((client as MollieApiError).isDefinitive).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    const server = await getMolliePayment("t", "tr_x").catch((e: unknown) => e);
    expect((server as MollieApiError).isDefinitive).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const network = await getMolliePayment("t", "tr_x").catch((e: unknown) => e);
    expect((network as MollieApiError).status).toBe(0);
    expect((network as MollieApiError).isDefinitive).toBe(false);
  });

  it("detects PayPal among the profile's enabled methods", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ _embedded: { methods: [{ id: "ideal" }, { id: "paypal" }] } }),
    );
    await expect(isMolliePaypalEnabled("t", "pfl_1")).resolves.toBe(true);
    expect(callAt(0)[0]).toContain("profileId=pfl_1");

    fetchMock.mockResolvedValueOnce(jsonResponse({ _embedded: { methods: [{ id: "ideal" }] } }));
    await expect(isMolliePaypalEnabled("t", "pfl_1")).resolves.toBe(false);
  });

  it("creates a refund with idempotency key and testmode", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "re_1", status: "queued" }));
    const refund = await createMollieRefund("t", "tr_1", {
      amountCents: 500,
      description: "Grund",
      idempotencyKey: "refund:abc",
    });
    expect(refund).toEqual({ id: "re_1", status: "queued" });
    const [url, init] = callAt(0);
    expect(url).toBe("https://api.mollie.com/v2/payments/tr_1/refunds");
    expect(init.headers["Idempotency-Key"]).toBe("refund:abc");
    expect(JSON.parse(init.body)).toMatchObject({
      amount: { currency: "EUR", value: "5.00" },
      testmode: true,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ctor, fetchClient } = vi.hoisted(() => ({
  ctor: vi.fn(),
  fetchClient: { kind: "fetch-http-client" },
}));

vi.mock("stripe", () => {
  class FakeStripe {
    static createFetchHttpClient = vi.fn(() => fetchClient);
    constructor(key: string, options: unknown) {
      ctor(key, options);
    }
  }
  return { default: FakeStripe };
});

import {
  createStripeClient,
  getStripeConnectWebhookSecret,
  getStripePaymentsWebhookSecret,
} from "./client";

describe("createStripeClient", () => {
  beforeEach(() => {
    ctor.mockClear();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when STRIPE_SECRET_KEY is unset", () => {
    expect(() => createStripeClient()).toThrow("STRIPE_SECRET_KEY must be set");
    expect(ctor).not.toHaveBeenCalled();
  });

  it.each(["sk_live_abc123", "rk_live_abc123", "pk_test_abc", "garbage"])(
    "refuses non-test key %s with the test-mode message",
    (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(() => createStripeClient()).toThrow(/TEST MODE key/);
      expect(ctor).not.toHaveBeenCalled();
    },
  );

  it.each(["sk_test_abc123", "rk_test_abc123"])("accepts %s", (key) => {
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    expect(() => createStripeClient()).not.toThrow();
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor.mock.calls[0]?.[0]).toBe(key);
  });

  it("constructs the client with the fetch HTTP client (Workers-compatible)", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    createStripeClient();
    const options = ctor.mock.calls[0]?.[1] as { httpClient: unknown; apiVersion: string };
    expect(options.httpClient).toBe(fetchClient);
    expect(options.apiVersion).toBeTruthy();
  });
});

describe("webhook secret getters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getStripeConnectWebhookSecret throws when unset and returns the value when set", () => {
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "");
    expect(() => getStripeConnectWebhookSecret()).toThrow("STRIPE_CONNECT_WEBHOOK_SECRET");
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connect");
    expect(getStripeConnectWebhookSecret()).toBe("whsec_connect");
  });

  it("getStripePaymentsWebhookSecret throws when unset and returns the value when set", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => getStripePaymentsWebhookSecret()).toThrow("STRIPE_WEBHOOK_SECRET");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_payments");
    expect(getStripePaymentsWebhookSecret()).toBe("whsec_payments");
  });

  it("keeps the two secrets independent", () => {
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_a");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_b");
    expect(getStripeConnectWebhookSecret()).not.toBe(getStripePaymentsWebhookSecret());
  });
});

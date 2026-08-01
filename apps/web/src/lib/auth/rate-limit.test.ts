import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  reserveAndCheckRateLimit,
  type RateLimitReservation,
  type RateLimitScope,
  type RateLimitStore,
} from "./rate-limit";

/**
 * In-memory fake store so this suite doesn't depend on a real
 * Supabase/Postgres instance. Mirrors the real store's semantics: only
 * `succeeded = false` attempts count, and counts are scoped both by `ip`
 * alone and by the `(ip, email)` combination.
 */
function createFakeStore(): RateLimitStore & {
  attempts: {
    id: string;
    scope: RateLimitScope;
    ip: string;
    email: string;
    succeeded: boolean;
    at: number;
  }[];
} {
  const attempts: {
    id: string;
    scope: RateLimitScope;
    ip: string;
    email: string;
    succeeded: boolean;
    at: number;
  }[] = [];

  return {
    attempts,
    async reserveAttempt(scope, ip, email, windowSeconds): Promise<RateLimitReservation> {
      const id = randomUUID();
      attempts.push({ id, scope, ip, email, succeeded: false, at: Date.now() });

      const since = Date.now() - windowSeconds * 1000;
      const ipCount = attempts.filter(
        (a) => a.scope === scope && a.ip === ip && !a.succeeded && a.at >= since,
      ).length;
      const ipEmailCount = attempts.filter(
        (a) =>
          a.scope === scope && a.ip === ip && a.email === email && !a.succeeded && a.at >= since,
      ).length;

      return { attemptId: id, ipCount, ipEmailCount };
    },
    async markSucceeded(attemptId) {
      const attempt = attempts.find((a) => a.id === attemptId);
      if (attempt) {
        attempt.succeeded = true;
      }
    },
  };
}

describe("reserveAndCheckRateLimit", () => {
  it("allows the first attempts within the limit", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 4; i += 1) {
      await store.reserveAttempt("login", "1.2.3.4", "user@example.com", 900);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(false);
  });

  it("blocks once the IP reaches maxAttempts across different emails", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 5; i += 1) {
      await store.reserveAttempt("login", "1.2.3.4", `user-${i}@example.com`, 900);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "someone-else@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(true);
  });

  it("blocks once the (ip, email) combination reaches maxAttempts", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 5; i += 1) {
      await store.reserveAttempt("login", "10.0.0.5", "target@example.com", 900);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "10.0.0.5",
      email: "target@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(true);
  });

  it("does NOT block a single email reached from many different IPs (fix for third-party lockout abuse)", async () => {
    // Ticket #7 fix cycle 1: an email-alone key let any anonymous third
    // party lock a known victim out by spraying failed attempts from many
    // source IPs. Each IP now only builds up its own (ip, email) bucket.
    const store = createFakeStore();
    for (let i = 0; i < 20; i += 1) {
      await store.reserveAttempt("login", `10.0.0.${i}`, "victim@example.com", 900);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "10.0.0.99",
      email: "victim@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(false);
  });

  it("does not count successful attempts toward the limit (fix for self-lockout)", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 10; i += 1) {
      const { attemptId } = await store.reserveAttempt("login", "1.2.3.4", "user@example.com", 900);
      await store.markSucceeded(attemptId);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(false);
  });

  it("does not count attempts from a different scope", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 10; i += 1) {
      await store.reserveAttempt("register", "1.2.3.4", "user@example.com", 900);
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(false);
  });

  it("does not count attempts outside the window", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 5; i += 1) {
      store.attempts.push({
        id: randomUUID(),
        scope: "login",
        ip: "1.2.3.4",
        email: "user@example.com",
        succeeded: false,
        at: Date.now() - 2 * 60 * 60 * 1000,
      });
    }

    const result = await reserveAndCheckRateLimit(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(result.limited).toBe(false);
  });
});

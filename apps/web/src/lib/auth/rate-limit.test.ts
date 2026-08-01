import { describe, expect, it } from "vitest";
import { isRateLimited, type RateLimitScope, type RateLimitStore } from "./rate-limit";

/** In-memory fake store so this suite doesn't depend on a real Supabase/Postgres instance. */
function createFakeStore(): RateLimitStore & {
  attempts: { scope: RateLimitScope; ip: string; email: string; succeeded: boolean; at: number }[];
} {
  const attempts: {
    scope: RateLimitScope;
    ip: string;
    email: string;
    succeeded: boolean;
    at: number;
  }[] = [];

  return {
    attempts,
    async countAttempts(scope, field, value, sinceIso) {
      const since = new Date(sinceIso).getTime();
      return attempts.filter(
        (a) =>
          a.scope === scope &&
          a.at >= since &&
          (field === "ip" ? a.ip === value : a.email === value),
      ).length;
    },
    async recordAttempt(scope, ip, email, succeeded) {
      attempts.push({ scope, ip, email, succeeded, at: Date.now() });
    },
  };
}

describe("isRateLimited", () => {
  it("allows the first attempts within the limit", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 4; i += 1) {
      await store.recordAttempt("login", "1.2.3.4", "user@example.com", false);
    }

    const limited = await isRateLimited(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(limited).toBe(false);
  });

  it("blocks once the IP reaches maxAttempts", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 5; i += 1) {
      await store.recordAttempt("login", "1.2.3.4", `user-${i}@example.com`, false);
    }

    const limited = await isRateLimited(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "someone-else@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(limited).toBe(true);
  });

  it("blocks once the email reaches maxAttempts, even from different IPs", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 5; i += 1) {
      await store.recordAttempt("login", `10.0.0.${i}`, "target@example.com", false);
    }

    const limited = await isRateLimited(store, {
      scope: "login",
      ip: "10.0.0.99",
      email: "target@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(limited).toBe(true);
  });

  it("does not count attempts from a different scope", async () => {
    const store = createFakeStore();
    for (let i = 0; i < 10; i += 1) {
      await store.recordAttempt("register", "1.2.3.4", "user@example.com", false);
    }

    const limited = await isRateLimited(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(limited).toBe(false);
  });

  it("does not count attempts outside the window", async () => {
    const store = createFakeStore();
    // Simulate attempts far in the past by directly pushing with an old timestamp.
    for (let i = 0; i < 5; i += 1) {
      store.attempts.push({
        scope: "login",
        ip: "1.2.3.4",
        email: "user@example.com",
        succeeded: false,
        at: Date.now() - 2 * 60 * 60 * 1000,
      });
    }

    const limited = await isRateLimited(store, {
      scope: "login",
      ip: "1.2.3.4",
      email: "user@example.com",
      maxAttempts: 5,
      windowSeconds: 900,
    });

    expect(limited).toBe(false);
  });
});

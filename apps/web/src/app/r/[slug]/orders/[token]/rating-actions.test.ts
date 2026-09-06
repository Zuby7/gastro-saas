import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveAttemptMock = vi.fn();
const markSucceededMock = vi.fn();
const submitOrderRatingMock = vi.fn();

vi.mock("@/lib/auth/client-ip", () => ({
  getClientIp: async () => "203.0.113.30",
}));

vi.mock("@/lib/auth/supabase-rate-limit-store", () => ({
  createSupabaseRateLimitStore: () => ({
    reserveAttempt: reserveAttemptMock,
    markSucceeded: markSucceededMock,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ __marker: "admin-client" }),
}));

class FakeRatingDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatingDomainError";
  }
}

vi.mock("@/lib/ratings/service", () => ({
  submitOrderRating: (...args: unknown[]) => submitOrderRatingMock(...args),
  RatingDomainError: FakeRatingDomainError,
}));

vi.mock("@/lib/orders/token", () => ({
  hashOrderAccessToken: () => "hashed-token",
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

function validFormData(): FormData {
  const fd = new FormData();
  fd.set("stars", "5");
  fd.set("comment", "Klasse!");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttemptMock.mockResolvedValue({ attemptId: "attempt-1", ipCount: 1, ipEmailCount: 1 });
  submitOrderRatingMock.mockResolvedValue({
    ratingId: "rating-1",
    stars: 5,
    comment: "Klasse!",
    createdAt: "2026-08-19T10:00:00.000Z",
  });
});

/**
 * Ticket #121, Epic-10 Opus review finding 4: the `rating` rate-limit scope
 * previously counted successful submissions toward the limit too (no
 * `markSucceeded()` call), unlike every other scope in this codebase --
 * pins the fix.
 */
describe("submitRatingAction", () => {
  it("calls markSucceeded with the reserved attemptId after a successful submission", async () => {
    const { submitRatingAction } = await import("./rating-actions");
    const initialState = {};

    const result = await submitRatingAction(
      "tenant-slug",
      "raw-token",
      initialState,
      validFormData(),
    );

    expect(result.success).toBe(true);
    expect(markSucceededMock).toHaveBeenCalledTimes(1);
    expect(markSucceededMock).toHaveBeenCalledWith("attempt-1");
  });

  it("never calls markSucceeded when the submission itself fails", async () => {
    submitOrderRatingMock.mockRejectedValueOnce(
      new FakeRatingDomainError("Sie haben diese Bestellung bereits bewertet."),
    );

    const { submitRatingAction } = await import("./rating-actions");
    const initialState = {};

    await submitRatingAction("tenant-slug", "raw-token", initialState, validFormData());

    expect(markSucceededMock).not.toHaveBeenCalled();
  });

  it("never calls submitOrderRating (or markSucceeded) once the rate limit is hit", async () => {
    reserveAttemptMock.mockResolvedValueOnce({
      attemptId: "attempt-1",
      ipCount: 999,
      ipEmailCount: 999,
    });

    const { submitRatingAction } = await import("./rating-actions");
    const initialState = {};

    const result = await submitRatingAction(
      "tenant-slug",
      "raw-token",
      initialState,
      validFormData(),
    );

    expect(result.error).toBeDefined();
    expect(submitOrderRatingMock).not.toHaveBeenCalled();
    expect(markSucceededMock).not.toHaveBeenCalled();
  });
});

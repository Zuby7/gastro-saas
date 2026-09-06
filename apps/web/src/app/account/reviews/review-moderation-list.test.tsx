import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModerationQueueRatingView } from "@/lib/ratings/types";
import { ReviewModerationList } from "./review-moderation-list";

vi.mock("./actions", () => ({
  moderateRatingAction: vi.fn(),
}));

const rating: ModerationQueueRatingView = {
  ratingId: "11111111-1111-4111-8111-111111111111",
  stars: 3,
  comment: "Sehr lecker!",
  ratedAt: "2026-08-19T10:00:00.000Z",
  status: "pending",
  moderatedByUserId: null,
  moderatedAt: null,
};

/**
 * Ticket #121, Epic-10 Opus review finding 1: `aria-label` on a bare
 * `<span>` (role=generic) is a prohibited ARIA attribute (axe-core
 * `aria-prohibited-attr`) -- screen readers may read the raw star glyphs
 * instead of the intended accessible name. Pins the fix: the star glyphs
 * are hidden from assistive tech (`aria-hidden`) and the accessible name is
 * exposed via a separate sr-only text node instead of an `aria-label` on a
 * generic element.
 */
describe("ReviewModerationList (ticket #121 a11y fix)", () => {
  it("never puts aria-label on the star rating span", () => {
    const { container } = render(
      <ReviewModerationList initialRatings={[rating]} canModerate={false} />,
    );

    const elementsWithAriaLabel = container.querySelectorAll("span[aria-label]");
    expect(elementsWithAriaLabel.length).toBe(0);
  });

  it("hides the raw star glyphs from assistive tech and exposes the star count via sr-only text instead", () => {
    render(<ReviewModerationList initialRatings={[rating]} canModerate={false} />);

    const srOnlyLabel = screen.getByText("3 von 5 Sternen");
    expect(srOnlyLabel).toHaveClass("sr-only");

    const hiddenGlyphs = srOnlyLabel.previousSibling as HTMLElement;
    expect(hiddenGlyphs).toHaveAttribute("aria-hidden", "true");
    expect(hiddenGlyphs.textContent).toBe("★★★☆☆");
  });
});

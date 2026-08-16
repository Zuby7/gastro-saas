import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Ticket #76: migrates the remaining hardcoded `text-brand-600` links on
 * this page (the access-denied fallback and the "Zurück" link) to the
 * schema-aware `--link-foreground` token (see `globals.css`), which
 * currently resolves to `colors.brand[600]`. This test locks in that the
 * actually-rendered pair (brand-600 on neutral-0/white cards) meets WCAG AA,
 * following the pattern established in `apps/web/src/app/page.a11y.test.ts`.
 */
describe("order detail page link color contrast (WCAG AA)", () => {
  it("'Zurück' / access-denied link (text-link-foreground on background) passes AA for normal text", () => {
    const result = validateContrastRatio(colors.brand[600], colors.neutral[0], "normal");
    expect(result.passesAA).toBe(true);
  });
});

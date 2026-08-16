import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Ticket #76: migrates the remaining hardcoded `text-brand-600` link on
 * this page ("Zum Zahlungsstatus") to the schema-aware `--link-foreground`
 * token (see `globals.css`), which currently resolves to
 * `colors.brand[600]`. This test locks in that the actually-rendered pair
 * (brand-600 on neutral-0/white background) meets WCAG AA, following the
 * pattern established in `apps/web/src/app/page.a11y.test.ts`.
 */
describe("Stripe onboarding return page link color contrast (WCAG AA)", () => {
  it("'Zum Zahlungsstatus' link (text-link-foreground on background) passes AA for normal text", () => {
    const result = validateContrastRatio(colors.brand[600], colors.neutral[0], "normal");
    expect(result.passesAA).toBe(true);
  });
});

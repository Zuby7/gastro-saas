---
name: research-service
description: Research one external service category for gastro-saas (e.g. hosting, email, error monitoring) using free-for.dev for discovery and official docs for verification, and produce a concise decision record for docs/platform/service-register.md.
---

Run in an isolated context (spawn a sub-agent) so verbose research doesn't bloat the main session.

## Steps

1. Discover candidates via [free-for.dev](https://free-for.dev/#/) for the requested category.
2. Verify current information via the provider's own official site/docs — free-for.dev entries can be stale. Note the date checked.
3. Compare at most 3 relevant candidates.
4. For each: free-tier limits, regional availability, data residency, GDPR/data-processing notes, rate limits, storage/bandwidth limits, upgrade-pricing risk, export/migration options, vendor lock-in risk, whether a credit card is required, whether the free plan is dev-only or also viable for a small production pilot, and a fallback option.
5. Explicitly flag if the category cannot genuinely be free (state why, and the closest free-tier-compatible option) rather than silently substituting something misleading.
6. Return a concise decision record — one provider chosen per capability unless redundancy is justified — to be appended to `docs/platform/service-register.md`. Do not provision or sign up for anything; research only.

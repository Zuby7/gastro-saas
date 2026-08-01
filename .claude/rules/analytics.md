---
description: Analytics rules — sales metrics, trends, low performers
paths: ["packages/domain/analytics/**"]
---

- Restaurant sales analytics are always computed from the platform's own order/order-item data — never from a third-party product-analytics tool (PostHog is for understanding usage of gastro-saas itself, not restaurant sales).
- Every metric has a documented definition (see `docs/data/domain-model.md` / ticket acceptance criteria) — don't ship an ambiguous number.
- Refunds and cancellations must correctly reduce net sales; archived/renamed dishes must still appear correctly in historical analytics.
- Trend comparisons always show the comparison period and sample size, and must not compare an incomplete current period against a complete prior one without saying so.
- "Low performer" language avoids unsupported causal claims (e.g. don't say "the price is why this sells poorly" without evidence) — show the underlying funnel numbers instead.
- Use configurable minimum sample-size thresholds before labeling anything a trend or a low performer.
- All analytics queries filter by tenant first — never tenant-last, to avoid an easy-to-miss cross-tenant leak in aggregates.

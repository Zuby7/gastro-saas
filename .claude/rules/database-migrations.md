---
description: Database & migration rules
paths: ["packages/database/**", "supabase/migrations/**"]
---

- Every new tenant-scoped table ships its Row Level Security policy in the *same* migration — never a follow-up ticket.
- Money columns are integer minor units (cents) with an explicit `currency` column — never floating point.
- Historical order/payment data is immutable: `order_items`/`order_item_selections` snapshot purchase-time name/price/tax/variant/extras independent of the live menu rows.
- Prefer archive/soft-delete over hard delete for anything that participates in historical orders.
- Migrations against local/preview/staging run automatically; migrations against production require explicit human approval and a documented rollback note in the PR.
- Never run a destructive reset (`db reset`, `DROP TABLE`, etc.) against anything but a local/throwaway database — this is hook-blocked for non-local targets.

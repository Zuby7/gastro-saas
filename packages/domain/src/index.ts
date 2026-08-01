// Domain modules (identity, tenants, authorization, menu, ordering,
// payments, ...) are added per-ticket as the domain model is implemented —
// see docs/architecture/domain-boundaries.md.
export * from "./audit";
export * from "./menu/quality";
export * from "./restaurant/opening-hours";

// Provider-neutral integration abstraction (Epic 12, ticket #38). Pure TS,
// no Supabase/network dependency -- mirrors packages/domain/src/payments'
// precedent of keeping provider-facing shapes/derivations testable without
// mocking an SDK. `apps/web/src/lib/integrations/service.ts` is the only
// caller that wires a provider implementation to real tenant data (via
// Supabase RPCs) and persists its result.
//
// Only a mock implementation exists today (`createMockIntegrationProvider`
// below) -- no real Lieferando/Wolt/Uber-Eats/POS adapter, per this ticket's
// explicit non-goals. A future real provider would implement this same
// `IntegrationProvider` interface; nothing in the surrounding application
// code (service.ts, the sync-job RPCs) is mock-specific.

/** Only 'mock' is accepted anywhere in this ticket -- see the migration's `provider_key` check constraint. */
export type IntegrationProviderKey = "mock";

/** Mirrors `integration_sync_jobs.job_type`'s check constraint. */
export type IntegrationJobType =
  "menu_export" | "availability_sync" | "order_import" | "order_confirmation";

/**
 * A minimal, already-published-menu-derived snapshot -- built by
 * `apps/web/src/lib/integrations/service.ts` from the same `get_public_menu`
 * RPC the public storefront uses, never from a client-supplied payload. This
 * is what keeps "the master menu is always the source of truth" (ticket's
 * acceptance criterion 2): the export is always a read of what's actually
 * published, not something a caller can fabricate.
 */
export interface MenuExportDish {
  id: string;
  name: string;
  priceCents: number | null;
  currency: string | null;
}

export interface MenuExportCategory {
  id: string;
  name: string;
  dishes: MenuExportDish[];
}

export interface MenuSnapshot {
  tenantSlug: string;
  categories: MenuExportCategory[];
}

export interface MenuExportResult {
  exportedAt: string;
  categoryCount: number;
  dishCount: number;
  payload: Record<string, unknown>;
}

export interface SimulatedIncomingOrderResult {
  externalOrderId: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface OrderConfirmationResult {
  externalOrderId: string;
  confirmedAt: string;
  payload: Record<string, unknown>;
}

/**
 * The provider-neutral surface every integration provider (mock today, a
 * real official/authorized partner API later) must implement. Deliberately
 * covers exactly this ticket's scope: menu export, and simulated order
 * import/confirmation. Price/availability sync (`availability_sync`, an
 * `integration_sync_jobs.job_type` value) is modeled at the data/job level
 * already but has no dedicated provider method yet -- not exercised by this
 * ticket's acceptance criteria, added when a concrete sync trigger exists.
 */
export interface IntegrationProvider {
  readonly key: IntegrationProviderKey;
  exportMenu(menu: MenuSnapshot): MenuExportResult;
  simulateIncomingOrder(menu: MenuSnapshot): SimulatedIncomingOrderResult;
  confirmOrder(externalOrderId: string): OrderConfirmationResult;
}

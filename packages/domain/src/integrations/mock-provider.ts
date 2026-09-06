import type {
  IntegrationProvider,
  MenuExportResult,
  MenuSnapshot,
  OrderConfirmationResult,
  SimulatedIncomingOrderResult,
} from "./provider";

export interface MockIntegrationProviderDeps {
  /** Injectable clock, so callers/tests get deterministic timestamps. */
  now: () => Date;
  /** Injectable id generator, so callers/tests get deterministic ids -- e.g. `() => crypto.randomUUID()` in `apps/web`. */
  generateId: () => string;
}

/**
 * The only integration provider implementation this ticket ships (per its
 * explicit non-goals: no real Lieferando/Wolt/Uber-Eats/POS adapter exists).
 * Deterministic and side-effect-free -- `apps/web/src/lib/integrations/service.ts`
 * is responsible for persisting whatever this returns via
 * `record_integration_sync_job`, and for never treating a mock result as
 * proof of a real external system having done anything.
 *
 * Never touches secrets: every field returned here is derived only from the
 * `MenuSnapshot` passed in (itself sourced from the tenant's own published
 * menu) or from the injected clock/id generator, per `.claude/rules/integrations.md`
 * ("a shared/mock provider must never leak one tenant's data into another
 * tenant's sync payload" -- there is no cross-tenant state here at all, this
 * function is pure per-call).
 */
export function createMockIntegrationProvider(
  deps: MockIntegrationProviderDeps,
): IntegrationProvider {
  const { now, generateId } = deps;

  return {
    key: "mock",

    exportMenu(menu: MenuSnapshot): MenuExportResult {
      const dishCount = menu.categories.reduce((sum, category) => sum + category.dishes.length, 0);

      return {
        exportedAt: now().toISOString(),
        categoryCount: menu.categories.length,
        dishCount,
        payload: {
          provider: "mock",
          tenantSlug: menu.tenantSlug,
          categories: menu.categories,
        },
      };
    },

    simulateIncomingOrder(menu: MenuSnapshot): SimulatedIncomingOrderResult {
      // Picks the first available dish from the exported (published) menu
      // so the simulated order references a real, currently-published item
      // rather than a fabricated one -- keeps this in line with "the master
      // menu is always the source of truth" (ticket acceptance criterion 2)
      // even for a fake inbound order.
      const sampleDish = menu.categories.flatMap((category) => category.dishes).at(0) ?? null;
      const externalOrderId = `mock-order-${generateId()}`;

      return {
        externalOrderId,
        receivedAt: now().toISOString(),
        payload: {
          provider: "mock",
          tenantSlug: menu.tenantSlug,
          externalOrderId,
          items: sampleDish ? [{ dishId: sampleDish.id, name: sampleDish.name, quantity: 1 }] : [],
        },
      };
    },

    confirmOrder(externalOrderId: string): OrderConfirmationResult {
      return {
        externalOrderId,
        confirmedAt: now().toISOString(),
        payload: {
          provider: "mock",
          externalOrderId,
          status: "confirmed",
        },
      };
    },
  };
}

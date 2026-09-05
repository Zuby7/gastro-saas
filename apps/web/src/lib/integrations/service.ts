import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMockIntegrationProvider,
  type MenuSnapshot,
} from "@gastro-saas/domain";
import type { PublicMenu } from "@/lib/public-menu/types";
import type {
  IntegrationAccountView,
  IntegrationSyncJobStatus,
  IntegrationSyncJobType,
  IntegrationSyncJobView,
} from "./types";

export class IntegrationDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationDomainError";
  }
}

/**
 * No published menu to export/simulate an order from -- the master menu
 * (ticket #38 acceptance criterion 2) genuinely has nothing published yet.
 * A distinct, safe-to-display error rather than a raw RPC failure.
 */
export class NoPublishedMenuError extends IntegrationDomainError {
  constructor() {
    super("Für dieses Restaurant ist noch keine Speisekarte veröffentlicht.");
  }
}

interface RawIntegrationAccountRow {
  id: string;
  provider_key: "mock";
  label: string;
  status: "mock" | "connected" | "error";
  created_at: string;
  updated_at: string;
}

interface RawIntegrationSyncJobRow {
  id: string;
  integration_account_id: string;
  job_type: IntegrationSyncJobType;
  status: IntegrationSyncJobStatus;
  payload: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapAccount(row: RawIntegrationAccountRow): IntegrationAccountView {
  return {
    id: row.id,
    providerKey: row.provider_key,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncJob(row: RawIntegrationSyncJobRow): IntegrationSyncJobView {
  return {
    id: row.id,
    integrationAccountId: row.integration_account_id,
    jobType: row.job_type,
    status: row.status,
    payload: row.payload,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * The provider this ticket ships (per its explicit non-goals: no real
 * Lieferando/Wolt/Uber-Eats/POS adapter exists). A future real provider
 * would be selected here by the integration account's `providerKey` instead
 * of always returning the mock -- nothing else in this file is mock-specific.
 */
function resolveProvider() {
  return createMockIntegrationProvider({
    now: () => new Date(),
    generateId: () => randomUUID(),
  });
}

/**
 * Ensures the tenant has a `mock` integration account, creating it on first
 * use (idempotent). Caller must already have called
 * `requireTenantPermission(supabase, tenantId, 'integrations.manage')` --
 * `create_integration_account()` independently re-checks the same permission.
 */
export async function ensureMockIntegrationAccount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<IntegrationAccountView> {
  const { data, error } = await supabase.rpc("create_integration_account", {
    p_tenant_id: tenantId,
    p_provider_key: "mock",
    p_label: "Mock-Integration",
  });

  if (error || !data) {
    throw new Error(`create_integration_account failed: ${error?.message ?? "no data returned"}`);
  }

  return mapAccount(data as RawIntegrationAccountRow);
}

/** Admin integrations overview read. Caller must already hold `integrations.manage`. */
export async function listIntegrationAccounts(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<IntegrationAccountView[]> {
  const { data, error } = await supabase.rpc("list_integration_accounts", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RawIntegrationAccountRow[]).map(mapAccount);
}

/** Admin integrations overview's recent-activity read. Caller must already hold `integrations.manage`. */
export async function listIntegrationSyncJobs(
  supabase: SupabaseClient,
  tenantId: string,
  integrationAccountId?: string,
): Promise<IntegrationSyncJobView[]> {
  const { data, error } = await supabase.rpc("list_integration_sync_jobs", {
    p_tenant_id: tenantId,
    p_integration_account_id: integrationAccountId ?? null,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RawIntegrationSyncJobRow[]).map(mapSyncJob);
}

async function recordSyncJob(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    integrationAccountId: string;
    jobType: IntegrationSyncJobType;
    status: IntegrationSyncJobStatus;
    payload: Record<string, unknown>;
    errorMessage?: string | null;
  },
): Promise<IntegrationSyncJobView> {
  const { data, error } = await supabase.rpc("record_integration_sync_job", {
    p_tenant_id: input.tenantId,
    p_integration_account_id: input.integrationAccountId,
    p_job_type: input.jobType,
    p_status: input.status,
    p_payload: input.payload,
    p_error_message: input.errorMessage ?? null,
  });

  if (error || !data) {
    throw new Error(`record_integration_sync_job failed: ${error?.message ?? "no data returned"}`);
  }

  return mapSyncJob(data as RawIntegrationSyncJobRow);
}

/**
 * Reads the tenant's own published menu via the same `get_public_menu` RPC
 * the storefront uses (never a client-supplied payload) and narrows it to
 * the `MenuSnapshot` shape the provider-neutral interface expects. Keeps
 * "the master menu is always the source of truth" (ticket acceptance
 * criterion 2) true for the mock provider too.
 */
function buildMenuSnapshot(tenantSlug: string, publicMenu: PublicMenu): MenuSnapshot {
  return {
    tenantSlug,
    categories: publicMenu.categories.map((category) => ({
      id: category.id,
      name: category.name,
      dishes: category.dishes.map((dish) => ({
        id: dish.id,
        name: dish.name,
        priceCents: dish.priceCents,
        currency: dish.currency,
      })),
    })),
  };
}

async function fetchPublishedMenuOrThrow(
  supabase: SupabaseClient,
  tenantSlug: string,
): Promise<PublicMenu> {
  const { data, error } = await supabase.rpc("get_public_menu", { p_tenant_slug: tenantSlug });

  if (error || !data) {
    throw new NoPublishedMenuError();
  }

  return data as PublicMenu;
}

/**
 * Runs the mock provider's menu export (ticket acceptance criterion 1,
 * first half) and records the outcome. Caller must already hold
 * `integrations.manage`; `record_integration_sync_job()` independently
 * re-checks it.
 */
export async function runMockMenuExport(
  supabase: SupabaseClient,
  input: { tenantId: string; tenantSlug: string; integrationAccountId: string },
): Promise<IntegrationSyncJobView> {
  const publicMenu = await fetchPublishedMenuOrThrow(supabase, input.tenantSlug);
  const snapshot = buildMenuSnapshot(input.tenantSlug, publicMenu);
  const provider = resolveProvider();
  const result = provider.exportMenu(snapshot);

  return recordSyncJob(supabase, {
    tenantId: input.tenantId,
    integrationAccountId: input.integrationAccountId,
    jobType: "menu_export",
    status: "succeeded",
    payload: {
      exportedAt: result.exportedAt,
      categoryCount: result.categoryCount,
      dishCount: result.dishCount,
      export: result.payload,
    },
  });
}

/**
 * Runs the mock provider's simulated incoming order followed by its
 * confirmation (ticket acceptance criterion 1, second half + the
 * "Bestellimport/-bestätigung" scope note) and records both outcomes. The
 * mock provider runs synchronously, so both jobs are recorded back-to-back
 * rather than as separate pending/async steps.
 */
export async function runMockSimulatedOrder(
  supabase: SupabaseClient,
  input: { tenantId: string; tenantSlug: string; integrationAccountId: string },
): Promise<{ importJob: IntegrationSyncJobView; confirmationJob: IntegrationSyncJobView }> {
  const publicMenu = await fetchPublishedMenuOrThrow(supabase, input.tenantSlug);
  const snapshot = buildMenuSnapshot(input.tenantSlug, publicMenu);
  const provider = resolveProvider();

  const incomingOrder = provider.simulateIncomingOrder(snapshot);
  const importJob = await recordSyncJob(supabase, {
    tenantId: input.tenantId,
    integrationAccountId: input.integrationAccountId,
    jobType: "order_import",
    status: "succeeded",
    payload: {
      externalOrderId: incomingOrder.externalOrderId,
      receivedAt: incomingOrder.receivedAt,
      order: incomingOrder.payload,
    },
  });

  const confirmation = provider.confirmOrder(incomingOrder.externalOrderId);
  const confirmationJob = await recordSyncJob(supabase, {
    tenantId: input.tenantId,
    integrationAccountId: input.integrationAccountId,
    jobType: "order_confirmation",
    status: "succeeded",
    payload: {
      externalOrderId: confirmation.externalOrderId,
      confirmedAt: confirmation.confirmedAt,
      confirmation: confirmation.payload,
    },
  });

  return { importJob, confirmationJob };
}

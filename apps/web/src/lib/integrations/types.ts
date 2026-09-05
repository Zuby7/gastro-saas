/** Mirrors `integration_accounts.status`'s check constraint. */
export type IntegrationAccountStatus = "mock" | "connected" | "error";

/** Mirrors `integration_sync_jobs.job_type`'s check constraint. */
export type IntegrationSyncJobType =
  | "menu_export"
  | "availability_sync"
  | "order_import"
  | "order_confirmation";

/** Mirrors `integration_sync_jobs.status`'s check constraint. */
export type IntegrationSyncJobStatus = "succeeded" | "failed";

/** One `integration_accounts` row, for the admin integrations overview (ticket's "verbunden/Mock/Fehler" UI states). */
export interface IntegrationAccountView {
  id: string;
  providerKey: "mock";
  label: string;
  status: IntegrationAccountStatus;
  createdAt: string;
  updatedAt: string;
}

/** One `integration_sync_jobs` row, for the admin integrations overview's recent-activity list. */
export interface IntegrationSyncJobView {
  id: string;
  integrationAccountId: string;
  jobType: IntegrationSyncJobType;
  status: IntegrationSyncJobStatus;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

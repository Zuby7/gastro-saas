import type {
  IntegrationAccountStatus,
  IntegrationSyncJobStatus,
  IntegrationSyncJobType,
} from "./types";

export function integrationAccountStatusLabel(status: IntegrationAccountStatus): string {
  switch (status) {
    case "mock":
      return "Mock";
    case "connected":
      return "Verbunden";
    case "error":
      return "Fehler";
    default:
      return status;
  }
}

export function integrationSyncJobTypeLabel(jobType: IntegrationSyncJobType): string {
  switch (jobType) {
    case "menu_export":
      return "Menü-Export";
    case "availability_sync":
      return "Preis-/Verfügbarkeits-Sync";
    case "order_import":
      return "Bestellimport";
    case "order_confirmation":
      return "Bestellbestätigung";
    default:
      return jobType;
  }
}

export function integrationSyncJobStatusLabel(status: IntegrationSyncJobStatus): string {
  switch (status) {
    case "succeeded":
      return "Erfolgreich";
    case "failed":
      return "Fehlgeschlagen";
    default:
      return status;
  }
}

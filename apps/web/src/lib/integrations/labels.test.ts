import { describe, expect, it } from "vitest";
import {
  integrationAccountStatusLabel,
  integrationSyncJobStatusLabel,
  integrationSyncJobTypeLabel,
} from "./labels";
import type {
  IntegrationAccountStatus,
  IntegrationSyncJobStatus,
  IntegrationSyncJobType,
} from "./types";

describe("integration labels", () => {
  it.each<[IntegrationAccountStatus, string]>([
    ["mock", "Mock"],
    ["connected", "Verbunden"],
    ["error", "Fehler"],
  ])("account status %s", (s, l) => {
    expect(integrationAccountStatusLabel(s)).toBe(l);
  });

  it.each<[IntegrationSyncJobType, string]>([
    ["menu_export", "Menü-Export"],
    ["availability_sync", "Preis-/Verfügbarkeits-Sync"],
    ["order_import", "Bestellimport"],
    ["order_confirmation", "Bestellbestätigung"],
  ])("job type %s", (s, l) => {
    expect(integrationSyncJobTypeLabel(s)).toBe(l);
  });

  it("job status labels", () => {
    expect(integrationSyncJobStatusLabel("succeeded" as IntegrationSyncJobStatus)).toBe(
      "Erfolgreich",
    );
    expect(integrationSyncJobStatusLabel("failed" as IntegrationSyncJobStatus)).toBe(
      "Fehlgeschlagen",
    );
  });

  it("falls back to the raw value for unknown inputs", () => {
    expect(integrationAccountStatusLabel("x" as IntegrationAccountStatus)).toBe("x");
    expect(integrationSyncJobTypeLabel("y" as IntegrationSyncJobType)).toBe("y");
    expect(integrationSyncJobStatusLabel("z" as IntegrationSyncJobStatus)).toBe("z");
  });
});

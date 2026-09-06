"use client";

import { useCallback, useState, useTransition } from "react";
import type { IntegrationAccountView, IntegrationSyncJobView } from "@/lib/integrations/types";
import {
  integrationAccountStatusLabel,
  integrationSyncJobStatusLabel,
  integrationSyncJobTypeLabel,
} from "@/lib/integrations/labels";
import { formatOrderTimestamp } from "@/lib/orders/format";
import { exportMenuAction, simulateIncomingOrderAction } from "./actions";

interface IntegrationsPanelProps {
  initialAccount: IntegrationAccountView | null;
  initialJobs: IntegrationSyncJobView[];
}

const STATUS_BADGE_CLASSNAME: Record<IntegrationAccountView["status"], string> = {
  mock: "bg-neutral-100 text-foreground",
  connected: "border border-success-500 bg-neutral-0 text-success-600",
  error: "border border-danger-500 bg-neutral-0 text-danger-600",
};

/**
 * Admin integrations overview (ticket #38): shows the mock integration
 * account's status (mock/verbunden/Fehler) and lets staff trigger the mock
 * provider's menu export and simulated incoming order. No polling/realtime --
 * this mirrors the moderation queue's precedent (not a live-updating
 * surface); the panel re-renders from each action's own result.
 */
export function IntegrationsPanel({ initialAccount, initialJobs }: IntegrationsPanelProps) {
  const [account, setAccount] = useState(initialAccount);
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, startExport] = useTransition();
  const [isSimulating, startSimulate] = useTransition();

  const handleExport = useCallback(() => {
    setError(null);
    startExport(async () => {
      const result = await exportMenuAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.jobs) {
        setJobs((current) => [...result.jobs!, ...current]);
        setAccount((current) => (current ? { ...current, status: "mock" } : current));
      }
    });
  }, []);

  const handleSimulateOrder = useCallback(() => {
    setError(null);
    startSimulate(async () => {
      const result = await simulateIncomingOrderAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.jobs) {
        setJobs((current) => [...result.jobs!, ...current]);
        setAccount((current) => (current ? { ...current, status: "mock" } : current));
      }
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-500 bg-neutral-0 p-3 text-sm text-danger-600"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-foreground">Mock-Integration</h2>
          <span
            data-testid="integration-account-status"
            className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
              STATUS_BADGE_CLASSNAME[account?.status ?? "mock"]
            }`}
          >
            {integrationAccountStatusLabel(account?.status ?? "mock")}
          </span>
        </div>
        <p className="text-sm text-foreground-secondary">
          Testet den provider-neutralen Integrations-Layer mit einem simulierten Anbieter -- keine
          echte Lieferando-/Wolt-/Uber-Eats-/Kassen-Anbindung.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="min-h-11 rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Menü exportieren (Mock)
          </button>
          <button
            type="button"
            disabled={isSimulating}
            onClick={handleSimulateOrder}
            className="min-h-11 rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Bestelleingang simulieren (Mock)
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground">Letzte Sync-Vorgänge</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-foreground-secondary">Noch keine Sync-Vorgänge vorhanden.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-foreground"
              >
                <span className="font-medium">{integrationSyncJobTypeLabel(job.jobType)}</span>
                <span
                  className={
                    job.status === "failed"
                      ? "rounded-full border border-danger-500 bg-neutral-0 px-2 py-0.5 text-xs font-medium text-danger-600"
                      : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-foreground"
                  }
                >
                  {integrationSyncJobStatusLabel(job.status)}
                </span>
                <span className="text-xs text-foreground-secondary">
                  {formatOrderTimestamp(job.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

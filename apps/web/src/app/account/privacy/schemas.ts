import { z } from "zod";

/** Server-side validation boundary for the retention-settings form (ticket #36). */
export const RetentionSettingsSchema = z.object({
  analyticsEventsRetentionDays: z.coerce
    .number()
    .int("Bitte geben Sie eine ganze Zahl ein.")
    .min(30, "Die Aufbewahrungsfrist muss mindestens 30 Tage betragen.")
    .max(3650, "Die Aufbewahrungsfrist darf höchstens 3650 Tage (10 Jahre) betragen."),
});

/** Server-side validation boundary for the deletion-request form (ticket #36). */
export const DeletionRequestSchema = z.object({
  reason: z.string().trim().max(500, "Die Begründung ist zu lang.").default(""),
});

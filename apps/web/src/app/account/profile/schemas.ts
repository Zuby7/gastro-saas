import { z } from "zod";

/** Server-side validation boundary for the restaurant profile form (ticket #11). */
export const ProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
  description: z.string().trim().max(2000, "Die Beschreibung ist zu lang.").default(""),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte geben Sie eine gültige E-Mail-Adresse ein.")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(40, "Die Telefonnummer ist zu lang.").optional().or(z.literal("")),
  timezone: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie eine Zeitzone an.")
    .max(80, "Die Zeitzone ist zu lang."),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Bitte geben Sie eine gültige Hex-Farbe an (z. B. #166534)."),
});

export type ProfileInput = z.infer<typeof ProfileSchema>;

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const OpeningHourRowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    opensAt: z.string().trim().optional().or(z.literal("")),
    closesAt: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((row, ctx) => {
    if (row.isClosed) {
      return;
    }
    if (!row.opensAt) {
      ctx.addIssue({ code: "custom", message: "Öffnungszeit fehlt.", path: ["opensAt"] });
    }
    if (!row.closesAt) {
      ctx.addIssue({ code: "custom", message: "Schließzeit fehlt.", path: ["closesAt"] });
    }
    if (row.opensAt && row.closesAt && row.opensAt >= row.closesAt) {
      ctx.addIssue({
        code: "custom",
        message: "Die Schließzeit muss nach der Öffnungszeit liegen.",
        path: ["closesAt"],
      });
    }
  });

export const OpeningHoursSchema = z.object({
  rows: z.array(OpeningHourRowSchema).length(7),
});

export type OpeningHourRow = z.infer<typeof OpeningHourRowSchema>;

export { WEEKDAYS };

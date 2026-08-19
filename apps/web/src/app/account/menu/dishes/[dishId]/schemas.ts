import { z } from "zod";

export const DishBasicsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
  description: z.string().trim().max(2000, "Die Beschreibung ist zu lang.").default(""),
  priceCents: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (value) => !value || /^\d+$/.test(value),
      "Bitte geben Sie einen Preis in Cent an (z. B. 1200).",
    ),
});

export const VariantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
  priceCents: z
    .string()
    .trim()
    .regex(/^\d+$/, "Bitte geben Sie einen Preis in Cent an (z. B. 1200)."),
});

export const OptionGroupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Bitte geben Sie einen Namen ein.")
      .max(200, "Der Name ist zu lang."),
    minSelections: z.coerce.number().int().min(0, "Muss mindestens 0 sein."),
    maxSelections: z.coerce.number().int().min(1, "Muss mindestens 1 sein."),
  })
  .refine((data) => data.minSelections <= data.maxSelections, {
    message: "Minimum darf das Maximum nicht überschreiten.",
    path: ["minSelections"],
  });

export const OptionSchema = z.object({
  optionGroupId: z.string().uuid("Bitte wählen Sie eine Optionsgruppe aus."),
  name: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
  priceDeltaCents: z.coerce.number().int().default(0),
});

export const LookupNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
});

export const AssignmentEntitySchema = z.enum(["allergen", "additive", "dietary_label"]);
export type AssignmentEntity = z.infer<typeof AssignmentEntitySchema>;

/**
 * Ticket #29: shared shape for the dish/variant/option availability toggle
 * forms. `availableAgainAt` is an optional `datetime-local` input value
 * (empty string means "no schedule, is_available is the sole source of
 * truth" -- see the migration header comment for the exact evaluation
 * rule); when provided it's parsed as a local wall-clock time and converted
 * to an ISO timestamp before being sent to the RPC.
 */
export const AvailabilitySchema = z.object({
  // NOT z.coerce.boolean(): that coerces via JS `Boolean(value)`, so the
  // literal string "false" (truthy as a non-empty string) would coerce to
  // `true` -- exactly backwards for a hidden `<input value="false">`. Parse
  // the two literal string values this form ever sends instead.
  isAvailable: z.enum(["true", "false"]).transform((value) => value === "true"),
  availableAgainAt: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (value) => !value || !Number.isNaN(new Date(value).getTime()),
      "Bitte geben Sie ein gültiges Datum/Uhrzeit an.",
    ),
});

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const IMAGE_EXTENSION_BY_MIME: Record<(typeof ALLOWED_IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

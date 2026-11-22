import { z } from "zod";

export const CategoryNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Namen ein.")
    .max(200, "Der Name ist zu lang."),
});

export const DishSchema = z.object({
  categoryId: z.string().uuid("Bitte wählen Sie eine Kategorie aus."),
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

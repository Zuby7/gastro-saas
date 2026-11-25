import { z } from "zod";

import { euroCentsField } from "@/lib/money/euro";

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
  /** Raw euro string from the form ("12,50"); parsed to integer cents. */
  priceEuro: euroCentsField({ required: false }),
});

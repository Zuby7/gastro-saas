import { z } from "zod";

/**
 * Server-side validation boundary for guest rating submission
 * (`.claude/rules/backend-api.md` "validate every input with a Zod schema
 * at the boundary"). `submit_order_rating()` re-validates the same
 * constraints server-side regardless -- never trust this schema alone as
 * authorization.
 */
export const RatingSchema = z.object({
  stars: z.coerce
    .number()
    .int("Bitte wählen Sie eine Bewertung von 1 bis 5 Sternen.")
    .min(1, "Bitte wählen Sie eine Bewertung von 1 bis 5 Sternen.")
    .max(5, "Bitte wählen Sie eine Bewertung von 1 bis 5 Sternen."),
  comment: z
    .string()
    .trim()
    .max(1000, "Der Kommentar ist zu lang.")
    .optional()
    .transform((value) => value ?? ""),
});

export type RatingInput = z.infer<typeof RatingSchema>;

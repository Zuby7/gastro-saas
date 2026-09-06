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

/**
 * Server-side validation boundary for the moderation queue's status-change
 * action (ticket #121, Epic-10 Opus review finding 2 -- `moderateRatingAction`
 * previously validated neither `ratingId` nor `status` via Zod at the
 * boundary, per `.claude/rules/backend-api.md`'s "validate every input with
 * a Zod schema at the boundary" convention). Not exploitable on its own
 * (`moderate_rating()` re-validates both server-side regardless, per this
 * repo's two-enforcement-layers standard), but kept consistent with every
 * other action in this codebase.
 */
export const ModerateRatingSchema = z.object({
  ratingId: z.string().uuid("Ungültige Bewertungs-ID."),
  status: z.enum(["pending", "released", "hidden"], {
    message: "Ungültiger Moderationsstatus.",
  }),
});

export type ModerateRatingInput = z.infer<typeof ModerateRatingSchema>;

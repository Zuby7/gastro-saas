import { z } from "zod";

export const RefundSchema = z.object({
  orderId: z.string().uuid("Ungültige Bestellung."),
  amountCents: z
    .string()
    .trim()
    .regex(/^\d+$/, "Bitte geben Sie einen Betrag in Cent an (z. B. 500).")
    .refine((value) => Number(value) > 0, "Der Betrag muss größer als 0 sein."),
  reason: z
    .string()
    .trim()
    .min(1, "Bitte geben Sie einen Grund an.")
    .max(500, "Der Grund ist zu lang (max. 500 Zeichen)."),
  // Client-generated (crypto.randomUUID()) idempotency token, one per
  // submission attempt (issue #97, risk:payment) -- see refund-service.ts's
  // module header. Prevents a double-clicked submission from creating two
  // independent refunds.
  requestToken: z.string().uuid("Ungültige Anfrage. Bitte laden Sie die Seite neu."),
});

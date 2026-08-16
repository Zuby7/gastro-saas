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
});

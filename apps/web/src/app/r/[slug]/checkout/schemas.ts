import { z } from "zod";

// Checkout only collects the data actually needed for the chosen
// fulfillment type (ticket #21 acceptance criterion 3) -- a discriminated
// union means a pickup submission can never even carry a `tableIdentifier`
// field (and vice versa) past this schema boundary, per
// `.claude/rules/backend-api.md`'s "validate every input with a Zod schema
// at the boundary" rule. The `create_order_from_cart` RPC re-validates the
// same constraints server-side regardless (never trust this schema alone as
// authorization).
const customerName = z
  .string()
  .trim()
  .min(1, "Bitte geben Sie Ihren Namen an.")
  .max(200, "Der Name ist zu lang.");

const customerNote = z
  .string()
  .trim()
  .max(500, "Der Hinweis ist zu lang.")
  .optional()
  .transform((value) => value ?? "");

export const CheckoutSchema = z.discriminatedUnion("fulfillmentType", [
  z.object({
    fulfillmentType: z.literal("pickup"),
    customerName,
    customerNote,
    customerPhone: z
      .string()
      .trim()
      .max(40, "Die Telefonnummer ist zu lang.")
      .optional()
      .transform((value) => (value ? value : null)),
  }),
  z.object({
    fulfillmentType: z.literal("table"),
    customerName,
    customerNote,
    tableIdentifier: z
      .string()
      .trim()
      .min(1, "Bitte geben Sie eine Tischnummer an.")
      .max(40, "Die Tischnummer ist zu lang."),
  }),
]);

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

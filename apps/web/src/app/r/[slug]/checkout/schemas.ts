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

// Ticket #146: explicit consent to the tenant's AGB/Datenschutzerklärung,
// required before an order can be placed -- checked server-side (never just
// the checkbox's `required` HTML attribute).
const acceptTerms = z.string().refine((value) => value === "on", {
  message: "Bitte akzeptieren Sie die AGB und die Datenschutzerklärung, um zu bestellen.",
});

// Issue #195: payment method chosen at checkout. Validated server-side against
// this allow-list; "paypal" is additionally only honoured when the tenant has a
// connected Mollie account with PayPal enabled (checked in the action).
export const PAYMENT_METHODS = ["stripe", "paypal"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const paymentMethod = z.enum(PAYMENT_METHODS, {
  message: "Bitte wählen Sie eine gültige Zahlungsart.",
});

export const CheckoutSchema = z.discriminatedUnion("fulfillmentType", [
  z.object({
    fulfillmentType: z.literal("pickup"),
    customerName,
    customerNote,
    acceptTerms,
    paymentMethod,
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
    acceptTerms,
    paymentMethod,
    tableIdentifier: z
      .string()
      .trim()
      .min(1, "Bitte geben Sie eine Tischnummer an.")
      .max(40, "Die Tischnummer ist zu lang."),
  }),
]);

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

import { z } from "zod";

export const AddToCartSchema = z.object({
  dishId: z.string().uuid("Ungültiges Gericht."),
  dishVariantId: z
    .string()
    .uuid("Ungültige Variante.")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  quantity: z.coerce.number().int().min(1, "Mindestens 1.").max(20, "Höchstens 20."),
  // Submitted as a JSON-encoded array of option ids (checkbox groups don't
  // give a stable single form-field shape) -- still fully re-validated
  // server-side (existence, tenant, min/max per group) by `add_cart_item`;
  // this schema only checks the wire shape.
  optionIds: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })
    .pipe(z.array(z.string().uuid())),
});

export const UpdateCartItemQuantitySchema = z.object({
  cartItemId: z.string().uuid("Ungültiger Artikel."),
  quantity: z.coerce.number().int().min(1, "Mindestens 1.").max(20, "Höchstens 20."),
});

export const RemoveCartItemSchema = z.object({
  cartItemId: z.string().uuid("Ungültiger Artikel."),
});

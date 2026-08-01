import { z } from "zod";

/** Server-side validation boundary for the registration form (`.claude/rules/backend-api.md`). */
export const RegisterSchema = z.object({
  tenantName: z
    .string()
    .trim()
    .min(2, "Der Restaurantname muss mindestens 2 Zeichen lang sein.")
    .max(120, "Der Restaurantname darf höchstens 120 Zeichen lang sein."),
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Der Slug muss mindestens 2 Zeichen lang sein.")
    .max(80, "Der Slug darf höchstens 80 Zeichen lang sein.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Der Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.",
    ),
  email: z.string().trim().toLowerCase().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z
    .string()
    .min(12, "Das Passwort muss mindestens 12 Zeichen lang sein.")
    .max(200, "Das Passwort ist zu lang."),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Server-side validation boundary for the login form. */
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z.string().min(1, "Bitte geben Sie Ihr Passwort ein."),
});

export type LoginInput = z.infer<typeof LoginSchema>;

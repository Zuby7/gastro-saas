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
    .min(2, "Die Web-Adresse muss mindestens 2 Zeichen lang sein.")
    .max(80, "Die Web-Adresse darf höchstens 80 Zeichen lang sein.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Die Web-Adresse darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.",
    ),
  email: z.string().trim().toLowerCase().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z
    .string()
    .min(12, "Das Passwort muss mindestens 12 Zeichen lang sein.")
    .max(200, "Das Passwort ist zu lang."),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Server-side validation boundary for the /account "create your restaurant"
 * fallback (ticket #7 fix cycle 1, item 4/5): same tenant name/slug rules
 * as registration, reused rather than duplicated.
 */
export const CreateTenantSchema = RegisterSchema.pick({ tenantName: true, tenantSlug: true });

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

/** Server-side validation boundary for the login form. */
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z.string().min(1, "Bitte geben Sie Ihr Passwort ein."),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const InviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  roleId: z.string().uuid("Bitte wählen Sie eine Rolle aus."),
});

export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

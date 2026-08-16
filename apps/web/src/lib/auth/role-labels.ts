/**
 * German display labels for role keys used across the two role concepts in
 * this schema: `tenant_memberships.role` (the simpler 'owner'|'manager'|'staff'
 * enum, see `20260801040000_tenant_membership_brand_location_model.sql`) and
 * the richer, tenant-scoped `roles.key` RBAC catalog seeded by
 * `seed_standard_roles_for_tenant()` ('owner'|'manager'|'kitchen'|'service'|'marketing',
 * see `20260801080000_roles_and_permissions_rbac.sql`). `roles.name` itself
 * stores an English display name ("Owner", "Kitchen", ...) -- that column is
 * a stable, tenant-customizable label for a future custom-role feature, not
 * user-facing copy, so it is deliberately not renamed here. This module is
 * the one place that translates the *known* role keys to the German label
 * shown in the UI; an unrecognized key (e.g. a future custom role) falls
 * back to the role's own `name`/the raw key as-is.
 */
const ROLE_KEY_LABELS_DE: Record<string, string> = {
  owner: "Inhaber",
  manager: "Geschäftsführung",
  staff: "Mitarbeiter",
  kitchen: "Küche",
  service: "Service",
  marketing: "Marketing",
};

export function roleLabel(roleKey: string, fallbackName?: string): string {
  return ROLE_KEY_LABELS_DE[roleKey] ?? fallbackName ?? roleKey;
}

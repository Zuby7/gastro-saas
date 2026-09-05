import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { ProfileForm, type ProfileFormInitialValues } from "./profile-form";
import { OpeningHoursForm, type OpeningHourInitialValue } from "./opening-hours-form";

interface RestaurantProfileRow {
  display_name: string;
  description: string;
  contact_email: string | null;
  phone: string | null;
  timezone: string;
  brand_color: string;
}

interface OpeningHourRow {
  weekday: number;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

/**
 * Ticket #11: restaurant profile + opening hours admin form. Gated on
 * `tenant.settings.write` server-side (never UI-only) -- a member without
 * the permission sees a plain access-denied message instead of the forms.
 */
export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "tenant.settings.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um das Restaurant-Profil zu bearbeiten.
          </p>
          <Link
            href="/account"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const { data: profile } = await supabase
    .from("restaurant_profiles")
    .select("display_name, description, contact_email, phone, timezone, brand_color")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<RestaurantProfileRow>();

  const { data: hours } = await supabase
    .from("opening_hours")
    .select("weekday, is_closed, opens_at, closes_at")
    .eq("tenant_id", membership.tenantId)
    .order("weekday")
    .returns<OpeningHourRow[]>();

  const profileInitial: ProfileFormInitialValues = {
    displayName: profile?.display_name ?? "",
    description: profile?.description ?? "",
    contactEmail: profile?.contact_email ?? "",
    phone: profile?.phone ?? "",
    timezone: profile?.timezone ?? "Europe/Berlin",
    brandColor: profile?.brand_color ?? "#166534",
  };

  const hoursByWeekday = new Map((hours ?? []).map((row) => [row.weekday, row]));
  const hoursInitial: OpeningHourInitialValue[] = Array.from({ length: 7 }, (_, weekday) => {
    const row = hoursByWeekday.get(weekday);
    return {
      weekday,
      isClosed: row?.is_closed ?? true,
      opensAt: row?.opens_at?.slice(0, 5) ?? "",
      closesAt: row?.closes_at?.slice(0, 5) ?? "",
    };
  });

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">Restaurant-Profil</h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <ProfileForm initial={profileInitial} />
        <OpeningHoursForm initial={hoursInitial} />
      </div>
    </main>
  );
}

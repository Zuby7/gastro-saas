import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "./accept-invitation-form";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-secondary p-8">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-neutral-200 bg-surface p-8 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Einladung annehmen
          </h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            Bestätigen Sie die Einladung mit dem Konto, dessen E-Mail-Adresse eingeladen wurde.
          </p>
        </div>

        {user ? (
          <AcceptInvitationForm token={token} />
        ) : (
          <p className="rounded-md border border-neutral-300 bg-surface-muted p-3 text-sm text-foreground">
            Bitte{" "}
            <Link href="/login" className="font-medium text-link-foreground underline">
              melden Sie sich an
            </Link>
            , um die Einladung anzunehmen.
          </p>
        )}
      </div>
    </main>
  );
}

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Einladung annehmen</h1>
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
    </main>
  );
}

"use server";

import { redirect } from "next/navigation";
import { hashInvitationToken } from "@/lib/invitations/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AcceptInvitationFormState {
  error?: string;
}

export async function acceptInvitationAction(
  _prevState: AcceptInvitationFormState,
  formData: FormData,
): Promise<AcceptInvitationFormState> {
  const token = String(formData.get("token") ?? "");
  if (!token) {
    return { error: "Der Einladungslink ist ungültig." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashInvitationToken(token),
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("expired")) {
      return { error: "Diese Einladung ist abgelaufen." };
    }
    if (message.includes("already")) {
      return { error: "Diese Einladung wurde bereits verwendet." };
    }
    return { error: "Diese Einladung kann nicht angenommen werden." };
  }

  redirect("/account");
}

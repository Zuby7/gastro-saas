interface SendInvitationEmailInput {
  to: string;
  inviteUrl: string;
  tenantName: string;
}

export async function sendInvitationEmail(input: SendInvitationEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "Gastro SaaS <onboarding@resend.dev>";

  if (!apiKey) {
    // Opus batch review (epic-3-5-batch, medium): never log the raw
    // single-use invite token/URL -- logging it here would let anyone with
    // log access accept the invitation without ever receiving the email.
    // Issue #204: the invitee's address is personal data and stays out of
    // the logs as well.
    console.info("[invitations] RESEND_API_KEY missing; invite generated (not sent)");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `Einladung zu ${input.tenantName}`,
      text: `Sie wurden zu ${input.tenantName} eingeladen. Einladung annehmen: ${input.inviteUrl}`,
    }),
  });

  if (!response.ok) {
    throw new Error("Invitation email could not be sent.");
  }
}

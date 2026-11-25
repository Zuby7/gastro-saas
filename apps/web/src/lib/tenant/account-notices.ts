/** Query parameter on /account that selects one of the fixed notices below. */
export const ACCOUNT_NOTICE_PARAM = "notice";

const ACCOUNT_NOTICES: Record<string, string> = {
  "tenant-slug-taken":
    "Ihr Konto wurde angelegt, aber die gewünschte Web-Adresse wurde in der Zwischenzeit vergeben. Bitte wählen Sie unten eine andere Web-Adresse, um Ihr Restaurant anzulegen.",
  "tenant-create-failed":
    "Ihr Konto wurde angelegt, aber Ihr Restaurant konnte noch nicht angelegt werden. Bitte prüfen Sie die Angaben unten und versuchen Sie es erneut.",
};

/** Maps the query value to a fixed German message; unknown values yield null (never echoed). */
export function accountNoticeMessage(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return Object.hasOwn(ACCOUNT_NOTICES, value) ? (ACCOUNT_NOTICES[value] ?? null) : null;
}

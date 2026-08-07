/** German date+time formatting for the guest-facing order-status page (ticket #22). */
export function formatOrderTimestamp(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoTimestamp));
}

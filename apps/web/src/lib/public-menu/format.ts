export function formatPrice(priceCents: number | null, currency: string): string {
  if (priceCents === null) {
    return "Preis nach Auswahl";
  }

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(priceCents / 100);
}

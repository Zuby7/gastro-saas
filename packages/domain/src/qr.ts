export interface QrTargetInput {
  baseUrl: string;
  tenantSlug: string;
  table?: string | null;
  pickup?: boolean;
}

export function buildTenantQrUrl(input: QrTargetInput): string {
  const url = new URL(`/r/${input.tenantSlug}`, input.baseUrl);

  if (input.table?.trim()) {
    url.searchParams.set("table", input.table.trim());
  }

  if (input.pickup) {
    url.searchParams.set("mode", "pickup");
  }

  return url.toString();
}

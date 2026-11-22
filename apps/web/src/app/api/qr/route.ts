import { buildTenantQrUrl } from "@gastro-saas/domain";
import QRCode from "qrcode";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Issue #204: the table label ends up inside the generated QR target URL, so
// it is bounded and restricted to a plain label charset (letters incl.
// umlauts, digits, space, dot, underscore, hyphen).
const TableParamSchema = z
  .string()
  .max(32)
  .regex(/^[\p{L}\p{N} ._-]*$/u);

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const rawTable = request.nextUrl.searchParams.get("table");
  const parsedTable = TableParamSchema.nullable().safeParse(rawTable);
  if (!parsedTable.success) {
    return new NextResponse("Invalid table", { status: 400 });
  }
  const table = parsedTable.data;
  const pickup = request.nextUrl.searchParams.get("pickup") === "1";

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenants ( slug )")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{ tenants: { slug: string } | null }>();

  if (!membership?.tenants || membership.tenants.slug !== slug) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const targetUrl = buildTenantQrUrl({ baseUrl, tenantSlug: slug, table, pickup });
  const svg = await QRCode.toString(targetUrl, { type: "svg", margin: 1, width: 512 });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `attachment; filename="${slug}-qr.svg"`,
      "Cache-Control": "no-store",
    },
  });
}

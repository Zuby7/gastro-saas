import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Order confirmation email (Epic 7, ticket #40) -- sent as a best-effort side
 * effect after `apps/web/src/lib/payments/webhook-service.ts` has already
 * durably transitioned an order `awaiting_payment -> received`.
 *
 * Reuses the same Resend REST call / API-key-handling shape established by
 * `apps/web/src/lib/invitations/email.ts` (ticket #8) rather than
 * introducing a second Resend integration approach. Unlike that module,
 * `sendOrderConfirmationEmail` below never throws: acceptance criterion 2
 * ("a failed send never blocks payment processing or resets order status")
 * means the caller (the webhook handler, whose own success response to
 * Stripe must not depend on email delivery) can call this without a
 * try/catch of its own. Every failure path is caught here, logged with a
 * clear tag, and recorded (status only, never content) in `email_sends` so
 * acceptance criterion 3 ("Resend's daily limit produces a VISIBLE error, not
 * a silently-lost email") has a durable, queryable trail -- Sentry is listed
 * in `docs/platform/service-register.md` as this project's error monitor,
 * but no ticket has actually wired `@sentry/nextjs` into this codebase yet
 * (verified: no `@sentry/*` dependency, no `Sentry.init` call anywhere in
 * apps/web). Reporting via a clearly tagged structured console.error plus
 * this table is the honest, proportionate stand-in until that infrastructure
 * ticket lands -- do not read the log line below as a real Sentry
 * integration.
 */

interface OrderRow {
  id: string;
  tenant_id: string;
  customer_name: string;
  fulfillment_type: string;
  table_identifier: string | null;
  total_cents: number;
  currency: string;
}

interface OrderItemRow {
  id: string;
  dish_name_snapshot: string;
  variant_name_snapshot: string | null;
  quantity: number;
  unit_price_cents_snapshot: number;
}

interface OrderItemSelectionRow {
  order_item_id: string;
  option_name_snapshot: string;
  price_delta_cents_snapshot: number;
}

interface RestaurantProfileRow {
  display_name: string;
  brand_color: string;
}

export interface OrderConfirmationEmailInput {
  tenantId: string;
  orderId: string;
  /**
   * Stripe Checkout's own hosted page always collects an email address from
   * the customer during payment (`session.customer_details.email` on the
   * completed session) -- there is no `customer_email`/similar column on
   * `orders` to persist this ticket's own scope, per the ticket's explicit
   * "don't invent new profile/order fields" guidance. `null` here means
   * Stripe did not report one (unexpected, but handled without throwing).
   */
  recipientEmail: string | null;
}

interface LineItem {
  label: string;
  quantity: number;
  totalCents: number;
}

function centsToDisplay(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
}

async function fetchOrder(admin: SupabaseClient, tenantId: string, orderId: string) {
  const { data } = await admin
    .from("orders")
    .select(
      "id, tenant_id, customer_name, fulfillment_type, table_identifier, total_cents, currency",
    )
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle<OrderRow>();

  return data;
}

async function fetchOrderItems(admin: SupabaseClient, orderId: string): Promise<OrderItemRow[]> {
  const { data } = await admin
    .from("order_items")
    .select("id, dish_name_snapshot, variant_name_snapshot, quantity, unit_price_cents_snapshot")
    .eq("order_id", orderId);

  return data ?? [];
}

async function fetchOrderItemSelections(
  admin: SupabaseClient,
  orderItemIds: string[],
): Promise<OrderItemSelectionRow[]> {
  if (orderItemIds.length === 0) return [];

  const { data } = await admin
    .from("order_item_selections")
    .select("order_item_id, option_name_snapshot, price_delta_cents_snapshot")
    .in("order_item_id", orderItemIds);

  return data ?? [];
}

async function fetchRestaurantProfile(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("restaurant_profiles")
    .select("display_name, brand_color")
    .eq("tenant_id", tenantId)
    .maybeSingle<RestaurantProfileRow>();

  return data;
}

function buildLineItems(items: OrderItemRow[], selections: OrderItemSelectionRow[]): LineItem[] {
  const selectionsByItem = new Map<string, OrderItemSelectionRow[]>();
  for (const selection of selections) {
    const existing = selectionsByItem.get(selection.order_item_id) ?? [];
    existing.push(selection);
    selectionsByItem.set(selection.order_item_id, existing);
  }

  return items.map((item) => {
    const itemSelections = selectionsByItem.get(item.id) ?? [];
    const selectionsTotalCents = itemSelections.reduce(
      (sum, selection) => sum + selection.price_delta_cents_snapshot,
      0,
    );
    const label = [
      item.dish_name_snapshot,
      item.variant_name_snapshot ? `(${item.variant_name_snapshot})` : null,
      itemSelections.length > 0
        ? `+ ${itemSelections.map((selection) => selection.option_name_snapshot).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      label,
      quantity: item.quantity,
      totalCents: (item.unit_price_cents_snapshot + selectionsTotalCents) * item.quantity,
    };
  });
}

function fulfillmentLabel(order: OrderRow): string {
  if (order.fulfillment_type === "table") {
    return order.table_identifier
      ? `Tischbestellung (Tisch ${order.table_identifier})`
      : "Tischbestellung";
  }
  if (order.fulfillment_type === "pickup") {
    // No pickup-time estimate field exists on `orders` yet (verified: no
    // ticket added one) -- omitted gracefully rather than inventing a fake
    // time, per the ticket's explicit guidance.
    return "Abholung";
  }
  return "Lieferung";
}

export function buildOrderConfirmationEmailContent(params: {
  order: OrderRow;
  lineItems: LineItem[];
  profile: RestaurantProfileRow | null;
}): { subject: string; html: string; text: string } {
  const { order, lineItems, profile } = params;
  const tenantName = profile?.display_name ?? "Ihr Restaurant";
  const brandColor = profile?.brand_color ?? "#166534";
  // Short, non-provider order reference (the ticket's own guidance: never a
  // raw Stripe payment-intent/session id in a customer-facing email) --
  // derived from our own order id, not a Stripe identifier.
  const orderReference = order.id.slice(0, 8).toUpperCase();
  const fulfillment = fulfillmentLabel(order);

  const itemRowsHtml = lineItems
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;">${item.quantity}x ${escapeHtml(item.label)}</td>
          <td style="padding:8px 0;text-align:right;">${escapeHtml(centsToDisplay(item.totalCents, order.currency))}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="de">
  <body style="font-family:Arial,sans-serif;color:#111;margin:0;padding:0;">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;">
      <tr>
        <td style="background:${escapeHtml(brandColor)};padding:24px;color:#fff;">
          <h1 style="margin:0;font-size:20px;">${escapeHtml(tenantName)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <h2 style="margin:0 0 8px;font-size:18px;">Bestellbestätigung</h2>
          <p style="margin:0 0 16px;">Hallo ${escapeHtml(order.customer_name)}, vielen Dank für Ihre Bestellung! Ihre Zahlung wurde erfolgreich verarbeitet.</p>
          <p style="margin:0 0 16px;">Bestellnummer: <strong>${escapeHtml(orderReference)}</strong><br />Art: ${escapeHtml(fulfillment)}</p>
          <table role="presentation" width="100%" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;border-bottom:1px solid #ddd;padding-bottom:8px;">Position</th>
                <th style="text-align:right;border-bottom:1px solid #ddd;padding-bottom:8px;">Preis</th>
              </tr>
            </thead>
            <tbody>${itemRowsHtml}</tbody>
            <tfoot>
              <tr>
                <td style="padding-top:12px;font-weight:bold;">Gesamt</td>
                <td style="padding-top:12px;font-weight:bold;text-align:right;">${escapeHtml(centsToDisplay(order.total_cents, order.currency))}</td>
              </tr>
            </tfoot>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    tenantName,
    "",
    "Bestellbestätigung",
    `Hallo ${order.customer_name}, vielen Dank für Ihre Bestellung! Ihre Zahlung wurde erfolgreich verarbeitet.`,
    "",
    `Bestellnummer: ${orderReference}`,
    `Art: ${fulfillment}`,
    "",
    ...lineItems.map(
      (item) =>
        `${item.quantity}x ${item.label} - ${centsToDisplay(item.totalCents, order.currency)}`,
    ),
    "",
    `Gesamt: ${centsToDisplay(order.total_cents, order.currency)}`,
  ];

  return {
    subject: `Bestellbestätigung – ${tenantName} (${orderReference})`,
    html,
    text: textLines.join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function recordEmailSend(
  admin: SupabaseClient,
  params: {
    tenantId: string;
    orderId: string;
    status: "sent" | "failed";
    failureReason?: string;
  },
): Promise<void> {
  const { error } = await admin.from("email_sends").insert({
    tenant_id: params.tenantId,
    order_id: params.orderId,
    email_type: "order_confirmation",
    status: params.status,
    failure_reason: params.failureReason ?? null,
  });

  if (error) {
    console.error("[notifications] failed to record email_sends row", error);
  }
}

/**
 * Sends the order confirmation email as a best-effort side effect. NEVER
 * throws -- every failure (missing recipient, missing API key, Resend
 * rejecting the request, Resend's daily-limit rate limiting) is caught,
 * logged with a clear `[notifications:order-confirmation]` tag, and recorded
 * in `email_sends` so it is visible in observability tooling rather than
 * silently lost (acceptance criteria 2 and 3).
 */
export async function sendOrderConfirmationEmail(
  admin: SupabaseClient,
  input: OrderConfirmationEmailInput,
): Promise<void> {
  const { tenantId, orderId, recipientEmail } = input;

  try {
    if (!recipientEmail) {
      console.error(
        "[notifications:order-confirmation] no recipient email available for order",
        orderId,
      );
      await recordEmailSend(admin, {
        tenantId,
        orderId,
        status: "failed",
        failureReason: "no_recipient_email",
      });
      return;
    }

    const order = await fetchOrder(admin, tenantId, orderId);
    if (!order) {
      console.error(
        "[notifications:order-confirmation] order not found when building confirmation email",
        orderId,
      );
      await recordEmailSend(admin, {
        tenantId,
        orderId,
        status: "failed",
        failureReason: "order_not_found",
      });
      return;
    }

    const items = await fetchOrderItems(admin, orderId);
    const selections = await fetchOrderItemSelections(
      admin,
      items.map((item) => item.id),
    );
    const profile = await fetchRestaurantProfile(admin, tenantId);
    const lineItems = buildLineItems(items, selections);
    const { subject, html, text } = buildOrderConfirmationEmailContent({
      order,
      lineItems,
      profile,
    });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL ?? "Gastro SaaS <onboarding@resend.dev>";

    if (!apiKey) {
      // Mirrors apps/web/src/lib/invitations/email.ts's established
      // fallback: never block the caller, never log sensitive content.
      console.info(
        "[notifications:order-confirmation] RESEND_API_KEY missing; confirmation not sent for order",
        orderId,
      );
      await recordEmailSend(admin, {
        tenantId,
        orderId,
        status: "failed",
        failureReason: "resend_api_key_missing",
      });
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
        to: recipientEmail,
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const isRateLimited = response.status === 429;
      console.error(
        `[notifications:order-confirmation] Resend send failed (status ${response.status}${isRateLimited ? ", RATE LIMITED -- likely the 100/day free-tier cap" : ""}) for order`,
        orderId,
      );
      await recordEmailSend(admin, {
        tenantId,
        orderId,
        status: "failed",
        failureReason: isRateLimited
          ? "resend_rate_limited"
          : `resend_api_error_${response.status}`,
      });
      return;
    }

    await recordEmailSend(admin, { tenantId, orderId, status: "sent" });
  } catch (error) {
    // Catch-all: a bug anywhere above (network error, unexpected shape, a
    // throw from a Supabase client call) must still never propagate to the
    // caller -- see this module's header / acceptance criterion 2.
    console.error(
      "[notifications:order-confirmation] unexpected error sending confirmation email for order",
      orderId,
      error,
    );
    try {
      await recordEmailSend(admin, {
        tenantId,
        orderId,
        status: "failed",
        failureReason: "unexpected_error",
      });
    } catch {
      // Recording the failure itself failed -- nothing more we can safely do
      // without risking a throw from this best-effort path.
    }
  }
}

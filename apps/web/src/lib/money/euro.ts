import { z } from "zod";

/**
 * Euro input helpers for admin forms. Staff type prices as euros ("12,50");
 * the database and every server action work with integer cents. Conversion
 * happens on the server from the raw string field (so a no-JS form post keeps
 * working) and never through floating point arithmetic.
 */

/** Default upper bound: EUR 100,000.00. */
export const MAX_EURO_INPUT_CENTS = 10_000_000;

export type EuroParseFailure = "empty" | "invalid" | "negative" | "too_many_decimals" | "too_large";

export type EuroParseResult = { ok: true; cents: number } | { ok: false; reason: EuroParseFailure };

export interface EuroParseOptions {
  /** Accept a leading minus (e.g. a discount on an option). Default false. */
  allowNegative?: boolean;
  /** Upper bound on the absolute value in cents. Default MAX_EURO_INPUT_CENTS. */
  maxCents?: number;
}

// Thousands grouping is only recognised when it is unambiguous: either both
// separator kinds appear, or the same separator repeats.
const GROUPED_DE = /^\d{1,3}(\.\d{3})+,\d+$/;
const GROUPED_DE_NO_DECIMALS = /^\d{1,3}(\.\d{3}){2,}$/;
const GROUPED_EN = /^\d{1,3}(,\d{3})+\.\d+$/;
const GROUPED_EN_NO_DECIMALS = /^\d{1,3}(,\d{3}){2,}$/;
const PLAIN_DECIMAL = /^\d+([.,]\d+)?$/;

/**
 * Parses a euro amount typed by a human into integer cents.
 * Accepts "12", "12,5", "12.50", "1.250,00", "1,250.00", with optional
 * surrounding spaces and a euro sign. A lone separator is always treated as
 * the decimal separator, so "1.250" is rejected (three decimals) instead of
 * being silently guessed as 1250 or 1.25.
 */
export function parseEuroToCents(input: string, options: EuroParseOptions = {}): EuroParseResult {
  const { allowNegative = false, maxCents = MAX_EURO_INPUT_CENTS } = options;

  let text = input.replace(/[\s ]/g, "").replace(/€/g, "");
  if (text === "") return { ok: false, reason: "empty" };

  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  let normalized: string;
  if (GROUPED_DE.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (GROUPED_DE_NO_DECIMALS.test(text)) {
    normalized = text.replace(/\./g, "");
  } else if (GROUPED_EN.test(text) || GROUPED_EN_NO_DECIMALS.test(text)) {
    normalized = text.replace(/,/g, "");
  } else if (PLAIN_DECIMAL.test(text)) {
    normalized = text.replace(",", ".");
  } else {
    return { ok: false, reason: "invalid" };
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > 2) return { ok: false, reason: "too_many_decimals" };
  if (whole.length > 9) return { ok: false, reason: "too_large" };

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (negative && cents !== 0 && !allowNegative) return { ok: false, reason: "negative" };
  if (cents > maxCents) return { ok: false, reason: "too_large" };

  return { ok: true, cents: negative && cents !== 0 ? -cents : cents };
}

/** Formats integer cents as a German euro string without symbol: 1250 -> "12,50". */
export function formatCentsAsEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${whole},${fraction}`;
}

const MESSAGES: Record<EuroParseFailure, string> = {
  empty: "Bitte geben Sie einen Betrag in Euro an (z. B. 12,50).",
  invalid: "Bitte geben Sie einen gültigen Betrag in Euro an (z. B. 12,50).",
  negative: "Der Betrag darf nicht negativ sein.",
  too_many_decimals: "Bitte höchstens zwei Nachkommastellen angeben, z. B. 12,50.",
  too_large: "Der Betrag ist zu hoch.",
};

export function euroParseMessage(reason: EuroParseFailure): string {
  return MESSAGES[reason];
}

/**
 * Zod field: euro string in, integer cents out. A required field rejects an
 * empty string; an optional one maps it to `null`.
 */
export function euroCentsField<R extends boolean>(
  options: EuroParseOptions & { required: R },
): z.ZodType<R extends true ? number : number | null> {
  const { required, ...parseOptions } = options;
  const schema = z
    .string()
    .nullish()
    .transform((value, ctx): number | null => {
      const text = value ?? "";
      if (!required && text.trim() === "") return null;
      const result = parseEuroToCents(text, parseOptions);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: euroParseMessage(result.reason) });
        return z.NEVER;
      }
      return result.cents;
    });
  return schema as unknown as z.ZodType<R extends true ? number : number | null>;
}

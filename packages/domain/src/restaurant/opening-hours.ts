export interface OpeningHourInput {
  weekday: number;
  isClosed: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
}

export function validateOpeningHour(input: OpeningHourInput): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
    errors.push("weekday must be between 0 and 6");
  }

  if (input.isClosed) {
    return errors;
  }

  if (!input.opensAt || !input.closesAt) {
    errors.push("open days require opensAt and closesAt");
    return errors;
  }

  if (input.opensAt >= input.closesAt) {
    errors.push("opensAt must be before closesAt");
  }

  return errors;
}

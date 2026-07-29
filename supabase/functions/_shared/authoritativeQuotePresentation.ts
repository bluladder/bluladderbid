export interface AuthoritativeServiceItem {
  name: string;
  amount?: number;
  frequency?: number;
  pricePerVisit?: number;
  annualTotal?: number;
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function toAuthoritativeServiceItems(
  lineItems: unknown[],
  quoteType: "one_time" | "recurring_plan",
): AuthoritativeServiceItem[] {
  const result: AuthoritativeServiceItem[] = [];

  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const jobber = item.jobberLineItem &&
        typeof item.jobberLineItem === "object"
      ? item.jobberLineItem as Record<string, unknown>
      : null;
    const nameValue = typeof item.label === "string"
      ? item.label
      : typeof jobber?.name === "string"
      ? jobber.name
      : "";
    const name = nameValue.trim();
    if (!name) continue;

    if (quoteType === "recurring_plan") {
      result.push({
        name,
        frequency: finiteNumber(item.frequency),
        pricePerVisit: finiteNumber(item.perVisitAmount),
        annualTotal: finiteNumber(item.annualAmount),
      });
    } else {
      result.push({
        name,
        amount: finiteNumber(item.amount),
      });
    }
  }

  return result;
}

export type DurationResult =
  | { status: "available"; minutes: number; source: "authoritative_quote" | "deterministic_duration_engine"; version: string | null }
  | { status: "unavailable"; minutes: null; source: null; reason: "missing_authoritative_duration" }
  | { status: "manual_review_required"; minutes: null; source: null; reason: string };

export function resolveAuthoritativeDuration(quote: { estimatedDurationMinutes?: unknown; durationSource?: unknown; durationVersion?: unknown; status?: unknown } | null): DurationResult {
  if (quote?.status === "manual_review_required") return { status:"manual_review_required", minutes:null, source:null, reason:"quote_requires_manual_review" };
  const minutes = quote?.estimatedDurationMinutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return { status:"unavailable", minutes:null, source:null, reason:"missing_authoritative_duration" };
  const source = quote?.durationSource === "deterministic_duration_engine" ? "deterministic_duration_engine" : "authoritative_quote";
  return { status:"available", minutes, source, version:typeof quote?.durationVersion === "string" ? quote.durationVersion : null };
}

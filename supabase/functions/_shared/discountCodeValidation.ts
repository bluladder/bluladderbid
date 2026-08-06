export type DiscountValidationClock = () => Date;

export type DiscountValidationReason =
  | "unknown"
  | "inactive"
  | "expired"
  | "exhausted"
  | "uncertain";

export type DiscountValidationResult =
  | {
      status: "valid";
      code: string;
      discountType: "percentage" | "fixed";
      discountValue: number;
    }
  | {
      status: "invalid";
      code: string;
      reason: DiscountValidationReason;
    };

// deno-lint-ignore no-explicit-any
export type DiscountValidationSupabase = any;

export const DISCOUNT_CODE_COLUMNS =
  "code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses";

export function normalizeAuthoritativeDiscountCode(
  value: string,
): string | null {
  const normalized = String(value ?? "")
    .toUpperCase()
    .trim();
  return /^[A-Z0-9]{3,20}$/.test(normalized) ? normalized : null;
}

function invalid(
  code: string,
  reason: DiscountValidationReason,
): DiscountValidationResult {
  return { status: "invalid", code, reason };
}

function safeNonnegativeInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function validateDiscountCodeRow(
  code: string,
  row: Record<string, unknown> | null,
  now: Date,
): DiscountValidationResult {
  if (!row) return invalid(code, "unknown");
  if (row.is_active !== true) return invalid(code, "inactive");
  if (
    row.expires_at !== null &&
    row.expires_at !== undefined &&
    row.expires_at !== ""
  ) {
    const expiresAt = new Date(String(row.expires_at));
    if (!Number.isFinite(expiresAt.getTime()))
      return invalid(code, "uncertain");
    if (expiresAt.getTime() <= now.getTime()) return invalid(code, "expired");
  }
  if (row.max_uses !== null && row.max_uses !== undefined) {
    const maxUses = safeNonnegativeInteger(row.max_uses);
    const usageCount = safeNonnegativeInteger(row.usage_count);
    if (maxUses === null || usageCount === null)
      return invalid(code, "uncertain");
    if (usageCount >= maxUses) return invalid(code, "exhausted");
  }
  const discountType =
    row.discount_type === "percentage"
      ? "percentage"
      : row.discount_type === "fixed"
        ? "fixed"
        : null;
  const discountValue = Number(row.discount_value);
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
    return invalid(code, "uncertain");
  }
  if (discountType === "percentage" && discountValue > 100) {
    return invalid(code, "uncertain");
  }
  return { status: "valid", code, discountType, discountValue };
}

export async function validateDiscountCodeAuthoritatively(
  supabase: DiscountValidationSupabase,
  code: string,
  opts: { now?: Date | DiscountValidationClock } = {},
): Promise<DiscountValidationResult> {
  const normalized = normalizeAuthoritativeDiscountCode(code);
  const resultCode =
    normalized ??
    String(code ?? "")
      .toUpperCase()
      .trim();
  if (!normalized) return invalid(resultCode, "unknown");
  try {
    const nowValue =
      typeof opts.now === "function" ? opts.now() : (opts.now ?? new Date());
    if (!(nowValue instanceof Date) || !Number.isFinite(nowValue.getTime())) {
      return invalid(normalized, "uncertain");
    }
    const { data, error } = await supabase
      .from("discount_codes")
      .select(DISCOUNT_CODE_COLUMNS)
      .eq("code", normalized)
      .maybeSingle();
    if (error) return invalid(normalized, "uncertain");
    return validateDiscountCodeRow(
      normalized,
      data as Record<string, unknown> | null,
      nowValue,
    );
  } catch {
    return invalid(normalized, "uncertain");
  }
}

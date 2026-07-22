// ============================================================================
// customerResolver.ts — returning-customer lookup by verified phone/email.
//
// Read-only: never creates or mutates customer rows. Ambiguous matches return
// a signal so the caller can ask for a non-sensitive disambiguator without
// revealing any stored PII. Lookup failures return `not_found` so the caller
// falls back safely to normal new-customer intake.
// ============================================================================

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ResolvedCustomer {
  customerId: string;
  firstName: string | null;
}

export type ResolveResult =
  | { kind: "resolved"; customer: ResolvedCustomer }
  | { kind: "ambiguous"; count: number }
  | { kind: "not_found" };

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Returning-customer lookup by verified phone (E.164). Matches variants
 *  stored as +1XXXXXXXXXX, 1XXXXXXXXXX, or XXXXXXXXXX. */
export async function resolveCustomerByPhone(
  supabase: SB,
  phoneE164: string,
): Promise<ResolveResult> {
  const d = digits(phoneE164);
  if (d.length < 10) return { kind: "not_found" };
  const variants = new Set<string>([phoneE164, d, d.slice(-10), `+${d}`, `1${d.slice(-10)}`, `+1${d.slice(-10)}`]);
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id, first_name, phone")
      .in("phone", Array.from(variants))
      .limit(5);
    if (error || !Array.isArray(data)) return { kind: "not_found" };
    // De-duplicate by id.
    const unique = new Map<string, { id: string; first_name: string | null }>();
    for (const row of data) unique.set(row.id, row);
    if (unique.size === 0) return { kind: "not_found" };
    if (unique.size > 1) return { kind: "ambiguous", count: unique.size };
    const only = Array.from(unique.values())[0];
    return { kind: "resolved", customer: { customerId: only.id, firstName: only.first_name } };
  } catch {
    return { kind: "not_found" };
  }
}

// ============================================================================
// identityAnchor — the ONE canonical read of "does this SMS thread have a
// deterministic customer identity right now?" Callers use this before any
// autonomous action whose safety depends on knowing WHO the customer is
// (attaching a quote session, selecting availability, holding a slot,
// booking, etc.).
//
// DETERMINISM CONTRACT
//   The identity anchor is derived ONLY from durable, deterministic signals
//   that were set by conversationContext.resolveInboundContext:
//     • confirmed_email_customer_id  (customer verified an email in-thread)
//     • customer_id + resolution_method = "customer_account"
//     • legacy non-voice customer_id + resolution_method = "phone_exact"
//       AND NOT awaiting_email_disambiguation
//   Provider ANI is a useful SMS lookup hint, but phone_exact is never a
//   durable voice identity anchor.
//   Everything else — newest quote, newest booking, shared property, name
//   similarity — is explicitly NOT treated as an anchor. Those are the exact
//   signals that leaked one customer's identity onto another's thread.
//
// FAIL-CLOSED
//   Any read error or missing row yields identity_status = "unreadable".
//   Downstream gates treat unreadable identity as "block any action that
//   requires an anchor" (scheduling / booking_confirmation / booking_execution).
// ============================================================================
// deno-lint-ignore-file no-explicit-any

type Supa = any;

export type IdentityStatus =
  | "resolved"
  | "ambiguous"
  | "unresolved"
  | "unreadable";

export interface IdentityAnchor {
  identity_status: IdentityStatus;
  resolved_customer_id: string | null;
  confirmed_email_customer_id: string | null;
  resolution_method: string | null;
  resolution_confidence: string | null;
  awaiting_email_disambiguation: boolean;
  /** Populated for unreadable state or an explicit identity conflict. */
  error?: string;
}

/** Signals we accept as a deterministic anchor. Name similarity / shared
 *  property / newest quote / newest booking are NOT in this set. */
const DETERMINISTIC_METHODS = new Set(["customer_account"]);

export async function readIdentityAnchor(
  supabase: Supa,
  conversationId: string | null | undefined,
  expectedOrganizationId: string | null = null,
): Promise<IdentityAnchor> {
  const blank: IdentityAnchor = {
    identity_status: "unreadable",
    resolved_customer_id: null,
    confirmed_email_customer_id: null,
    resolution_method: null,
    resolution_confidence: null,
    awaiting_email_disambiguation: false,
  };
  if (!conversationId) return { ...blank, error: "conversation_missing" };

  let row: any = null;
  try {
    let query = supabase
      .from("chat_conversations")
      .select(
        "id, organization_id, channel, customer_id, confirmed_email_customer_id, resolution_method, resolution_confidence, awaiting_email_disambiguation",
      )
      .eq("id", conversationId);
    if (expectedOrganizationId) {
      query = query.eq("organization_id", expectedOrganizationId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) return { ...blank, error: error.message ?? String(error) };
    if (!data) return { ...blank, error: "conversation_missing" };
    if (
      expectedOrganizationId &&
      data.organization_id !== expectedOrganizationId
    ) {
      return { ...blank, error: "organization_context_mismatch" };
    }
    row = data;
  } catch (e) {
    return { ...blank, error: String(e).slice(0, 200) };
  }

  const linked_customer_id: string | null =
    (row.customer_id as string | null) ?? null;
  const confirmed_email_customer_id: string | null =
    (row.confirmed_email_customer_id as string | null) ?? null;
  const customerIdConflict = !!linked_customer_id &&
    !!confirmed_email_customer_id &&
    linked_customer_id !== confirmed_email_customer_id;
  // A confirmed-email anchor is the durable customer authority. Never return
  // a stale linked customer when the two columns disagree.
  const candidate_customer_id: string | null = customerIdConflict
    ? null
    : confirmed_email_customer_id ?? linked_customer_id;
  const resolution_method: string | null =
    (row.resolution_method as string | null) ?? null;
  const resolution_confidence: string | null =
    (row.resolution_confidence as string | null) ?? null;
  const awaiting_email_disambiguation =
    row.awaiting_email_disambiguation === true;

  let identity_status: IdentityStatus;
  if (customerIdConflict) {
    identity_status = "ambiguous";
  } else if (confirmed_email_customer_id) {
    identity_status = "resolved";
  } else if (
    resolution_method === "ambiguous" || awaiting_email_disambiguation
  ) {
    identity_status = "ambiguous";
  } else if (
    candidate_customer_id &&
    resolution_method &&
    (DETERMINISTIC_METHODS.has(resolution_method) ||
      (resolution_method === "phone_exact" && row.channel !== "voice"))
  ) {
    identity_status = "resolved";
  } else {
    identity_status = "unresolved";
  }
  // Never expose a merely linked candidate as resolved authority when the
  // status is ambiguous or unresolved. Callers must gate on both fields, and
  // this null is defense in depth for legacy callers that only inspect the ID.
  const resolved_customer_id = identity_status === "resolved"
    ? candidate_customer_id
    : null;

  return {
    identity_status,
    resolved_customer_id,
    confirmed_email_customer_id,
    resolution_method,
    resolution_confidence,
    awaiting_email_disambiguation,
    ...(customerIdConflict ? { error: "customer_identity_conflict" } : {}),
  };
}

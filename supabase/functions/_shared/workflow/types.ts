// ============================================================================
// workflow/types.ts — shared types for the Call-Center Workflow Router (v1).
//
// Sequencing is deterministic: the controller returns a typed Action; the LLM
// only produces natural wording for it. Actions never encode business
// decisions in free text.
// ============================================================================

import type { QuoteSession } from "../quoteSession.ts";

export type WorkflowId =
  | "new_quote"
  | "schedule_service"
  | "existing_quote"
  | "reschedule"
  | "cancel"
  | "question_or_memo"
  | "general_inquiry"
  | "out_of_scope";

/**
 * Field ids come from the canonical intake contract at runtime. Keeping a
 * second closed union here caused newly approved service fields to fall out of
 * the controller, so this type intentionally accepts canonical string ids.
 */
export type RequiredField = string;

export type HandoffReason =
  | "out_of_scope_workflow"
  | "commercial_bid"
  | "unsupported_service"
  | "pricing_error"
  | "ambiguous_customer_match"
  | "safety_or_access_flag"
  | "owner_decision_required"
  | "tenant_authority_required";

export type WorkflowAction =
  | { kind: "ask"; field: RequiredField; prompt: string }
  | { kind: "answer_side_question"; topic: string }
  | { kind: "calculate_price" }
  | { kind: "speak_price" }
  | { kind: "offer_scheduling" }
  | { kind: "collect_address_for_booking" }
  | { kind: "fetch_availability" }
  | {
    kind: "offer_slots";
    slots?: Array<{
      slotId: string;
      startAt: string;
      endAt: string;
      label: string;
      timezone?: string;
    }>;
  }
  | { kind: "confirm_slot"; slotId?: string; spoken?: string }
  | { kind: "book_dry_run" }
  | { kind: "book_real" }
  | { kind: "confirm_result"; success?: boolean; reference?: string }
  | { kind: "retrieve_existing_quote" }
  | { kind: "retrieve_upcoming_bookings" }
  | { kind: "prepare_reschedule" }
  | { kind: "confirm_reschedule"; bookingId: string; slotId: string }
  | { kind: "prepare_cancel" }
  | { kind: "confirm_cancel"; bookingId: string }
  | { kind: "record_field_memo"; bookingId: string; text: string }
  | { kind: "handoff"; reason: HandoffReason }
  | { kind: "end"; reason: string };

export interface TurnInput {
  utterance: string;
  channel: "voice" | "web" | "sms";
  session: QuoteSession;
  history: { role: "user" | "assistant"; content: string }[];
}

export interface TurnResult {
  action: WorkflowAction;
  spoken: string;
  toolEvents: { name: string; result: unknown }[];
  latency: {
    extractor?: number;
    persist?: number;
    reload?: number;
    controller?: number;
    price?: number;
    availability?: number;
    total: number;
  };
}

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
  | "cancel_or_reschedule"
  | "general_inquiry"
  | "out_of_scope";

export type RequiredField =
  | "services"
  | "windowCleaningScope"
  | "squareFootage"
  | "windowCleaningSides"
  | "stories"
  | "windowCleaningCondition"
  | "address"
  | "city"
  | "contact_email"
  | "contact_phone"
  | "contact_name";

export type HandoffReason =
  | "out_of_scope_workflow"
  | "commercial_bid"
  | "unsupported_service"
  | "pricing_error"
  | "ambiguous_customer_match"
  | "safety_or_access_flag";

export type WorkflowAction =
  | { kind: "ask"; field: RequiredField; prompt: string }
  | { kind: "answer_side_question"; topic: string }
  | { kind: "calculate_price" }
  | { kind: "speak_price" }
  | { kind: "offer_scheduling" }
  | { kind: "collect_address_for_booking" }
  | { kind: "fetch_availability" }
  | { kind: "offer_slots" }
  | { kind: "confirm_slot" }
  | { kind: "book_dry_run" }
  | { kind: "book_real" }
  | { kind: "confirm_result" }
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

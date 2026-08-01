// ============================================================================
// workflowRouter.ts — intent classification for the incoming utterance.
//
// Pure function. No LLM call, no persistence. Emits a WorkflowId; the
// controller then instantiates the matching workflow FSM.
// ============================================================================

import type { QuoteSession } from "../quoteSession.ts";
import type { WorkflowId } from "./types.ts";
import { classifyVoiceJourneyIntent } from "../voice/voiceJourneyContract.ts";

const NEW_QUOTE = /(price|quote|estimate|cost|how much|window\s*(cleaning|wash)|pressure\s*wash|gutter)/i;
const SCHEDULE = /(schedule|book|appointment|when can you|earliest|available)/i;
const CANCEL_RESCHEDULE = /(cancel|reschedul|move.*appointment|change.*time)/i;
const GENERAL = /(hours|open|located|what do you do|do you (offer|service|clean))/i;

export function classifyWorkflow(utterance: string, session: QuoteSession | null): WorkflowId {
  const sticky = session?.fields.voiceJourney?.intent;
  const s = (utterance ?? "").trim();
  if (!sticky && GENERAL.test(s)) return "general_inquiry";
  const voiceIntent = sticky ?? classifyVoiceJourneyIntent(s);
  if (voiceIntent === "existing_quote") return "existing_quote";
  if (voiceIntent === "reschedule") return "reschedule";
  if (voiceIntent === "cancel") return "cancel";
  if (voiceIntent === "question_or_memo") return "question_or_memo";
  if (voiceIntent === "new_quote") return "new_quote";
  if (voiceIntent === "schedule") return "schedule_service";
  if (!s) {
    if (session && (session.fields.services?.length ?? 0) > 0) return "new_quote";
    return "general_inquiry";
  }
  if (CANCEL_RESCHEDULE.test(s)) {
    return /cancel/i.test(s) ? "cancel" : "reschedule";
  }
  if (SCHEDULE.test(s) && session && session.quoteStatus !== "none") return "schedule_service";
  if (NEW_QUOTE.test(s)) return "new_quote";
  if (SCHEDULE.test(s)) return "schedule_service";
  if (GENERAL.test(s)) return "general_inquiry";
  // Default: if we already have a quote-in-progress, stay on it.
  if (session && (session.fields.services?.length ?? 0) > 0) return "new_quote";
  return "general_inquiry";
}

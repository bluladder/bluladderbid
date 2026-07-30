// ============================================================================
// voiceExitIntents.ts — deterministic handling of frustrated / leaving /
// "let me talk to a person" callers.
//
// Incident 019fb51e: the caller said "I'm about to hang up", "Please hurry"
// and "Can I talk to Ben?" while the assistant repeated "One moment please"
// and the same intake question. These intents are now classified BEFORE the
// model and answered deterministically and truthfully.
// ============================================================================

export type VoiceExitIntent = "human_request" | "leaving" | "hurry" | null;

const HUMAN =
  /\b(talk|speak|connect|transfer)\s+(?:to|with)\s+(?:a\s+)?(?:person|human|someone|somebody|rep|representative|ben|benjamin|bryan|owner|manager)\b|\b(?:can|could)\s+i\s+(?:talk|speak)\s+to\s+\w+|\bget me a human\b|\bhuman\b/i;
const LEAVING =
  /\b(?:i'?m|i am)\s+(?:about to|going to|gonna)\s+hang up\b|\bi'?ll talk to you later\b|\bi have to go\b|\bi'?m done\b|\bgotta go\b|\bhanging up\b/i;
const HURRY =
  /\bplease hurry\b|\bhurry up\b|\bthis is taking (?:too )?long\b|\bcome on\b|\bi'?m in a hurry\b/i;

export function classifyVoiceExitIntent(utterance: string): VoiceExitIntent {
  const t = String(utterance ?? "");
  if (!t.trim()) return null;
  if (HUMAN.test(t)) return "human_request";
  if (LEAVING.test(t)) return "leaving";
  if (HURRY.test(t)) return "hurry";
  return null;
}

/** Deterministic replies never get a filler acknowledgement in front. */
export function suppressAcknowledgement(utterance: string): boolean {
  if (classifyVoiceExitIntent(utterance) !== null) return true;
  const t = String(utterance ?? "").trim();
  if (!t) return false;
  // Corrections and spelled answers are follow-ups, not new slow requests.
  if (/^\s*(no|nope|that'?s (?:not|wrong)|wrong|incorrect)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:[A-Za-z][ ,.-]+){2,}[A-Za-z]\b/.test(t) && t.length <= 60) {
    return true;
  }
  return false;
}

export interface VoiceExitPlan {
  reply: string;
  event: string;
  /** Intake must stop for these dispositions. */
  stopsIntake: boolean;
}

export function planVoiceExitIntent(
  intent: Exclude<VoiceExitIntent, null>,
  ctx: { escalationAlreadyRecorded?: boolean; nextQuestion?: string } = {},
): VoiceExitPlan {
  if (intent === "human_request") {
    return {
      reply: ctx.escalationAlreadyRecorded
        ? "You're already on our team's list — Ben or someone from BluLadder will call you back shortly."
        : "Absolutely. I've passed this to our team and someone from BluLadder will call you back shortly.",
      event: ctx.escalationAlreadyRecorded
        ? "voice_human_request_reused"
        : "voice_human_request_escalated",
      stopsIntake: true,
    };
  }
  if (intent === "leaving") {
    return {
      reply:
        "No problem — you can hang up whenever you like. I'll send your online quote link to the number you're calling from.",
      event: "voice_caller_leaving",
      stopsIntake: true,
    };
  }
  return {
    reply: ctx.nextQuestion ?? "About how many square feet is your home?",
    event: "voice_caller_hurry",
    stopsIntake: false,
  };
}

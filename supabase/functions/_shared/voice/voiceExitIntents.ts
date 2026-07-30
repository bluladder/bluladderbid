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
  /** True only when a canonical escalation record now exists. */
  escalationRecorded?: boolean;
}

export function planVoiceExitIntent(
  intent: Exclude<VoiceExitIntent, null>,
  ctx: {
    escalationAlreadyRecorded?: boolean;
    nextQuestion?: string;
    /** Customer-facing message returned by the escalate_to_human tool. */
    escalationMessage?: string | null;
    /** True only when the tool actually recorded the escalation. */
    escalationSucceeded?: boolean;
  } = {},
): VoiceExitPlan {
  if (intent === "human_request") {
    // Already recorded earlier in this call: reuse it, never escalate twice.
    if (ctx.escalationAlreadyRecorded) {
      return {
        reply:
          "You're already on our team's list — someone from BluLadder will follow up with you.",
        event: "voice_human_request_reused",
        stopsIntake: true,
        escalationRecorded: true,
      };
    }
    // The spoken sentence is whatever the canonical tool says is true. No
    // delivery claim is ever invented here.
    if (ctx.escalationSucceeded) {
      const message = String(ctx.escalationMessage ?? "").trim();
      return {
        reply: message ||
          "I've recorded your request for a person and our team will follow up with you.",
        event: "voice_human_request_escalated",
        stopsIntake: true,
        escalationRecorded: true,
      };
    }
    return {
      reply:
        "I wasn't able to record that request just now. You can reach our team directly by calling our office, and I'll keep trying on my end.",
      event: "voice_human_request_escalation_failed",
      stopsIntake: true,
      escalationRecorded: false,
    };
  }
  if (intent === "leaving") {
    return {
      // Truthful conditional language: the post-call SMS handoff depends on a
      // provider call-ended event we do not control, so we never assert a send.
      reply:
        "You can hang up. I'll try to text the online quote link to the number you're calling from.",
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

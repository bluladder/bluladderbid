export type CompletedVoiceTurnReply =
  | { status: "found"; spoken: string }
  | { status: "unavailable"; reason: string };

export type CompletedVoiceTurnReplay =
  | { status: "replay"; spoken: string }
  | {
    status: "suppressed";
    reason: "reply_unavailable" | "turn_not_authoritative";
    detail?: string;
  };

export function mayReplayCompletedVoiceTurnClaim(
  claim: "acquired" | "duplicate" | "stale" | "wait" | "uncertain",
): claim is "duplicate" | "stale" {
  // A provider can reconnect after the original response body was interrupted
  // and receive `stale` from the position uniqueness guard. Replay still has
  // to pass the exact tenant/session/turn/position/content-hash journal check
  // below; this predicate never authorizes controller or provider work.
  return claim === "duplicate" || claim === "stale";
}

/**
 * Resolve a retry only from the canonical journal row for the exact completed
 * turn, then recheck single-flight authority immediately before replay. The
 * resolver cannot invoke the controller or an external provider action.
 */
export async function resolveCompletedVoiceTurnReplay(
  dependencies: {
    readReply: () => Promise<CompletedVoiceTurnReply>;
    isAuthoritative: () => Promise<boolean>;
  },
): Promise<CompletedVoiceTurnReplay> {
  const reply = await dependencies.readReply();
  if (reply.status !== "found") {
    return {
      status: "suppressed",
      reason: "reply_unavailable",
      detail: reply.reason,
    };
  }
  try {
    if (!await dependencies.isAuthoritative()) {
      return { status: "suppressed", reason: "turn_not_authoritative" };
    }
  } catch {
    return { status: "suppressed", reason: "turn_not_authoritative" };
  }
  return { status: "replay", spoken: reply.spoken };
}

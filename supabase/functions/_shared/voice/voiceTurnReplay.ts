export type CompletedVoiceTurnReply =
  | { status: "found"; spoken: string; authoritativeTurnId?: string }
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
    isAuthoritative: (turnId?: string) => Promise<boolean>;
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
    if (!await dependencies.isAuthoritative(reply.authoritativeTurnId)) {
      return { status: "suppressed", reason: "turn_not_authoritative" };
    }
  } catch {
    return { status: "suppressed", reason: "turn_not_authoritative" };
  }
  return { status: "replay", spoken: reply.spoken };
}

/**
 * A concurrent provider retry receives `wait` while the acquired request is
 * still running. Poll only for the exact durable controller reply, for a
 * bounded interval, then apply the same fresh authority check used by
 * duplicate/stale replay. No controller or provider operation can run here.
 */
export async function waitForCompletedVoiceTurnReplay(
  dependencies: {
    readReply: () => Promise<CompletedVoiceTurnReply>;
    isAuthoritative: (turnId?: string) => Promise<boolean>;
    delay?: (milliseconds: number) => Promise<void>;
  },
  options: {
    maxAttempts?: number;
    intervalMs?: number;
  } = {},
): Promise<CompletedVoiceTurnReplay> {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 16, 20));
  const intervalMs = Math.max(25, Math.min(options.intervalMs ?? 250, 500));
  const delay = dependencies.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const replay = await resolveCompletedVoiceTurnReplay(dependencies);
    if (
      replay.status === "replay" ||
      replay.reason === "turn_not_authoritative" ||
      replay.detail !== "reply_missing" ||
      attempt === maxAttempts
    ) {
      return replay;
    }
    await delay(intervalMs);
  }
  return {
    status: "suppressed",
    reason: "reply_unavailable",
    detail: "reply_missing",
  };
}

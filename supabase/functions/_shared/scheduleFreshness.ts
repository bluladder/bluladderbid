// Shared helper that decides whether the local Jobber schedule mirror is fresh
// enough to safely drive customer-facing availability and booking conflict
// checks. The mirror is kept up to date by `jobber-autosync`; a full sweep that
// finishes cleanly (no throttle, no error) stamps `last_full_sync_completed_at`.
//
// Safety rules (see request spec):
//  - Stale  => last complete sweep older than STALE_THRESHOLD_MINUTES.
//  - InProgress => an autosync currently holds the lock (within lock TTL).
//  - NeverCompleted => no clean full sweep has ever finished.
// In any of these states availability must be withheld rather than guessed.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export const STALE_THRESHOLD_MINUTES = 30;
export const LOCK_TTL_MINUTES = 30;

export interface MirrorFreshness {
  ok: boolean;
  reason:
    | "fresh"
    | "never_completed"
    | "stale"
    | "sync_in_progress"
    | "config_unavailable";
  ageMinutes: number | null;
  syncInProgress: boolean;
  lastCompleteSyncAt: string | null;
}

const CUSTOMER_MESSAGE =
  "Live scheduling is temporarily unavailable while we refresh our calendar. Please try again in a few minutes or request a callback and our team will help you book.";

export function unavailableCustomerMessage(): string {
  return CUSTOMER_MESSAGE;
}

export async function getMirrorFreshness(
  supabase: AnyClient,
  staleThresholdMinutes: number = STALE_THRESHOLD_MINUTES,
): Promise<MirrorFreshness> {
  const { data: cfg, error } = await supabase
    .from("autosync_config")
    .select(
      "last_full_sync_completed_at, lock_holder_id, lock_acquired_at, last_run_status",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error || !cfg) {
    // Fail safe: if we cannot read sync state, treat the mirror as unreliable.
    return {
      ok: false,
      reason: "config_unavailable",
      ageMinutes: null,
      syncInProgress: false,
      lastCompleteSyncAt: null,
    };
  }

  const now = Date.now();

  // A sync is "in progress" only if the lock is held AND was acquired recently.
  // A stale lock (holder set but older than the TTL) is treated as expired so a
  // crashed run can't block availability forever.
  let syncInProgress = false;
  if (cfg.lock_holder_id && cfg.lock_acquired_at) {
    const lockAgeMin = (now - new Date(cfg.lock_acquired_at).getTime()) / 60000;
    syncInProgress = lockAgeMin < LOCK_TTL_MINUTES;
  }

  const lastCompleteSyncAt: string | null = cfg.last_full_sync_completed_at ?? null;
  const ageMinutes = lastCompleteSyncAt
    ? (now - new Date(lastCompleteSyncAt).getTime()) / 60000
    : null;

  // A fresh, cleanly-completed snapshot is authoritative. The near-term autosync
  // holds the lock for ~75s every 5 minutes, so a routine refresh is in progress
  // roughly a quarter of the time. That refresh does NOT invalidate the last
  // completed snapshot — it only produces a newer one. Serving the fresh snapshot
  // while a routine refresh runs is safe and prevents ~25% of availability
  // requests from failing closed for no reason.
  //
  // This does NOT weaken the 30-minute safety threshold: we still require a
  // completed sweep no older than `staleThresholdMinutes`. `syncInProgress` is
  // surfaced for administrators/logs but no longer withholds fresh data.
  const haveFreshSnapshot =
    lastCompleteSyncAt !== null &&
    ageMinutes !== null &&
    ageMinutes <= staleThresholdMinutes;

  if (haveFreshSnapshot) {
    return {
      ok: true,
      reason: "fresh",
      ageMinutes,
      syncInProgress,
      lastCompleteSyncAt,
    };
  }

  // No trustworthy snapshot to serve. Fail closed, but report the most specific
  // reason so administrators can distinguish the cases:
  //  - a sync is actively running (first sync, or a refresh recovering staleness)
  //  - no clean sweep has ever completed
  //  - the last completed sweep is older than the safety threshold
  if (syncInProgress) {
    return {
      ok: false,
      reason: "sync_in_progress",
      ageMinutes,
      syncInProgress: true,
      lastCompleteSyncAt,
    };
  }

  if (!lastCompleteSyncAt || ageMinutes === null) {
    return {
      ok: false,
      reason: "never_completed",
      ageMinutes: null,
      syncInProgress: false,
      lastCompleteSyncAt: null,
    };
  }

  return {
    ok: false,
    reason: "stale",
    ageMinutes,
    syncInProgress: false,
    lastCompleteSyncAt,
  };
}

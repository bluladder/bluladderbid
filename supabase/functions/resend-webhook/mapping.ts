// Pure-function event mapping + transition guard for the Resend webhook.
// Kept in its own module so tests can import without pulling npm: specifiers.

export type AttemptStatus =
  | "sent" | "delivered" | "delayed" | "bounced" | "complained" | "failed" | "suppressed";

export function mapEventToAttemptStatus(type: string):
  | { status: AttemptStatus; column: string }
  | null
{
  const t = type.toLowerCase();
  if (t === "email.sent")             return { status: "sent",       column: "sent_at"       };
  if (t === "email.delivered")        return { status: "delivered",  column: "delivered_at"  };
  if (t === "email.delivery_delayed") return { status: "delayed",    column: "delayed_at"    };
  if (t === "email.bounced" || t === "email.hard_bounced")
                                      return { status: "bounced",    column: "bounced_at"    };
  if (t === "email.complained")       return { status: "complained", column: "complained_at" };
  if (t === "email.failed")           return { status: "failed",     column: "suppressed_at" };
  return null;
}

const TERMINAL: ReadonlySet<AttemptStatus> = new Set(["delivered", "bounced", "complained", "failed", "suppressed"]);
const RANK: Record<AttemptStatus, number> = {
  sent: 1, delayed: 2, delivered: 5, bounced: 5, complained: 5, failed: 5, suppressed: 5,
};

export function shouldApplyTransition(
  currentStatus: string | null | undefined,
  next: AttemptStatus,
): boolean {
  const cur = (currentStatus ?? "accepted") as AttemptStatus | "accepted";
  if (cur !== "accepted" && TERMINAL.has(cur as AttemptStatus)) return false;
  if (cur === "accepted") return true;
  return (RANK[next] ?? 0) >= (RANK[cur as AttemptStatus] ?? 0);
}

// ============================================================================
// knowledgeSync.ts — pure, testable logic for the controlled BluLadder.com
// knowledge sync. NO network here (the edge function performs the bounded,
// allowlisted fetch and calls these helpers). This module enforces:
//   * an explicit allowlist of BluLadder.com page types (no arbitrary crawl,
//     no user-provided URLs, no external domains, no old Staten Island / NY)
//   * source hashing so unchanged pages create no new revision
//   * conflict flagging so policy/price/guarantee/phone changes never
//     auto-publish and never override the canonical engines
// ============================================================================

/** Only these BluLadder.com hosts are ever allowed. */
const ALLOWED_HOSTS = new Set(["bluladder.com", "www.bluladder.com"]);

/**
 * Allowlisted path prefixes on BluLadder.com. Anything else (blog opinions,
 * directories, NY / Staten Island content, arbitrary pages) is rejected.
 */
export const ALLOWED_PATH_PREFIXES = [
  "/",
  "/faq",
  "/faqs",
  "/services",
  "/service-areas",
  "/dfw",
  "/window-cleaning",
  "/gutter-cleaning",
  "/roof-cleaning",
  "/house-washing",
  "/pressure-washing",
  "/preparation",
  "/policies",
  "/guarantee",
  "/contact",
];

/** Explicitly excluded path fragments (old markets / non-authoritative). */
const EXCLUDED_FRAGMENTS = [
  "staten-island",
  "statenisland",
  "new-york",
  "newyork",
  "/ny",
  "/blog",
  "/reviews",
  "/directory",
];

export function isAllowedKnowledgeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return false;
  const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (EXCLUDED_FRAGMENTS.some((f) => path.includes(f))) return false;
  return ALLOWED_PATH_PREFIXES.some(
    (p) => path === p || (p !== "/" && path.startsWith(p)),
  );
}

/** Stable content hash (FNV-1a, 32-bit hex). Deterministic, no crypto import. */
export function hashContent(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Categories where website text must NEVER auto-publish; owner must approve. */
const CONFLICT_CATEGORIES = new Set(["policy", "guarantee", "pricing", "contact"]);

/** Detects material that could override a protected source (price, phone, etc.). */
export function isConflictSensitive(category: string, content: string): boolean {
  if (CONFLICT_CATEGORIES.has(category)) return true;
  return /\$\s?\d|\bprice\b|\bguarantee\b|\bphone\b|\bcall us\b|\d{3}[-.\s]?\d{4}/i.test(
    content,
  );
}

export interface ScrapedItem {
  knowledgeKey: string;
  title: string;
  content: string;
  category: string;
  applicableService?: string | null;
  applicableRegion?: string | null;
  sourcePage: string;
}

export interface ExistingItem {
  knowledgeKey: string;
  content: string;
  sourceHash: string | null;
  reviewStatus: string;
}

export type SyncAction =
  | { type: "unchanged"; knowledgeKey: string }
  | {
      type: "new_draft" | "changed_draft" | "conflict";
      knowledgeKey: string;
      item: ScrapedItem;
      hash: string;
      requiresOwnerReview: boolean;
    };

/**
 * Produce a reviewable set of actions. NEVER publishes — every added/changed
 * item becomes a draft (or conflict), preserving prior published content.
 */
export function diffKnowledge(
  scraped: ScrapedItem[],
  existing: ExistingItem[],
): SyncAction[] {
  const byKey = new Map(existing.map((e) => [e.knowledgeKey, e]));
  const actions: SyncAction[] = [];
  for (const item of scraped) {
    const hash = hashContent(item.content);
    const prev = byKey.get(item.knowledgeKey);
    const conflict = isConflictSensitive(item.category, item.content);

    if (!prev) {
      actions.push({
        type: conflict ? "conflict" : "new_draft",
        knowledgeKey: item.knowledgeKey,
        item,
        hash,
        requiresOwnerReview: conflict,
      });
      continue;
    }
    if (prev.sourceHash === hash) {
      actions.push({ type: "unchanged", knowledgeKey: item.knowledgeKey });
      continue;
    }
    actions.push({
      type: conflict ? "conflict" : "changed_draft",
      knowledgeKey: item.knowledgeKey,
      item,
      hash,
      requiresOwnerReview: conflict,
    });
  }
  return actions;
}

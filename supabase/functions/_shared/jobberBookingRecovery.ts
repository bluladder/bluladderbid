// ============================================================================
// jobberBookingRecovery — Phase 6B.2 correlation utility used by the SMS
// booking reconciliation runner.
//
// When executeSmsBooking finishes with an UNKNOWN external outcome
// (`external_outcome_unknown`), the temporary hold is preserved and this
// module is used to determine whether Jobber actually created the job.
//
// Correlation strategy
// --------------------
// `jobber-create-booking` stamps the canonical booking idempotency key into
// the Jobber job's private instructions as a line of the form
//     `Ref: <idempotencyKey>`
// (see jobber-create-booking/index.ts). We query recent jobs and match on
// that substring in the instructions field, restricted to a bounded lookback
// window and page count so we never blow the API budget.
//
// The result is intentionally simple:
//   - `matched`  → found a job whose instructions contain the ref line;
//                  returns its id and (if scheduled) the first visit id.
//   - `not_found` → completed a bounded search without finding it. Callers
//                  can treat this as VERIFIED not_created.
//   - `error`    → Jobber threw or returned throttled/malformed results.
//                  Callers must NOT release the hold; retry later.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { jobberGraphQL } from "./jobberClient.ts";

export interface RecoveryMatched {
  outcome: "matched";
  jobberJobId: string;
  jobberVisitId: string | null;
  referenceNumber: string | null;
}
export interface RecoveryNotFound {
  outcome: "not_found";
  pagesScanned: number;
}
export interface RecoveryError {
  outcome: "error";
  detail: string;
  throttled?: boolean;
}
export type RecoveryResult = RecoveryMatched | RecoveryNotFound | RecoveryError;

export interface RecoveryOptions {
  /** Idempotency key to search for. Required. */
  idempotencyKey: string;
  /** Only look at jobs created at or after this timestamp. */
  createdAfter: Date;
  /** Hard cap on pages of jobs to inspect. */
  maxPages?: number;
  /** GraphQL executor override (test seam). */
  graphql?: typeof jobberGraphQL;
}

const PAGE_SIZE = 50;

// Jobber GraphQL query. `jobs.filter.createdAt` narrows the scan window;
// instructions is a private field on Job which we scan client-side because
// Jobber's GraphQL API does not expose free-text search on that column.
const JOBS_QUERY = `
  query RecoveryJobs($after: String, $createdAfter: ISO8601DateTime!) {
    jobs(
      first: ${PAGE_SIZE},
      after: $after,
      filter: { createdAt: { after: $createdAfter } }
    ) {
      nodes {
        id
        jobNumber
        instructions
        visits(first: 1) { nodes { id } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface JobsResponse {
  jobs: {
    nodes: Array<{
      id: string;
      jobNumber: number | null;
      instructions: string | null;
      visits?: { nodes: Array<{ id: string }> };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** True when the idempotency ref line matches a candidate's instructions.
 *  We match on the exact `Ref: <key>` line to avoid substring collisions. */
export function matchesIdempotencyRef(
  instructions: string | null | undefined,
  idempotencyKey: string,
): boolean {
  if (!instructions || !idempotencyKey) return false;
  const needle = `Ref: ${idempotencyKey}`;
  // Exact line match — accepts leading/trailing whitespace on the line.
  return instructions.split(/\r?\n/).some((line) => line.trim() === needle);
}

export async function findJobberJobByIdempotencyKey(
  opts: RecoveryOptions,
): Promise<RecoveryResult> {
  if (!opts.idempotencyKey) {
    return { outcome: "error", detail: "missing_idempotency_key" };
  }
  const gql = opts.graphql ?? jobberGraphQL;
  const maxPages = Math.max(1, opts.maxPages ?? 6);
  let cursor: string | null = null;
  let pagesScanned = 0;

  for (let i = 0; i < maxPages; i++) {
    const result = await gql<JobsResponse>(JOBS_QUERY, {
      after: cursor,
      createdAfter: opts.createdAfter.toISOString(),
    });
    pagesScanned++;

    if (result.throttled) {
      return { outcome: "error", detail: "jobber_throttled", throttled: true };
    }
    if (result.errors && result.errors.length > 0) {
      return {
        outcome: "error",
        detail: result.errors.map((e) => e.message).join("; ") || "graphql_error",
      };
    }
    const nodes = result.data?.jobs?.nodes ?? [];
    for (const node of nodes) {
      if (matchesIdempotencyRef(node.instructions, opts.idempotencyKey)) {
        return {
          outcome: "matched",
          jobberJobId: String(node.id),
          jobberVisitId: node.visits?.nodes?.[0]?.id
            ? String(node.visits.nodes[0].id)
            : null,
          referenceNumber:
            node.jobNumber != null ? String(node.jobNumber) : null,
        };
      }
    }
    const page = result.data?.jobs?.pageInfo;
    if (!page?.hasNextPage || !page.endCursor) {
      return { outcome: "not_found", pagesScanned };
    }
    cursor = page.endCursor;
  }

  // Exhausted page budget without a hit. Do NOT declare not_found — treat
  // as an error so the runner keeps the hold and retries later.
  return {
    outcome: "error",
    detail: `page_budget_exhausted_after_${pagesScanned}`,
  };
}
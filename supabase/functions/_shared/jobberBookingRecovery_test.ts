// Unit tests for the Phase 6B.2 Jobber correlation helper.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findJobberJobByIdempotencyKey,
  matchesIdempotencyRef,
} from "./jobberBookingRecovery.ts";

Deno.test("matchesIdempotencyRef: exact line match", () => {
  const instructions = "Booking notes.\nRef: abc-123\nCustomer prefers side gate.";
  assertEquals(matchesIdempotencyRef(instructions, "abc-123"), true);
});

Deno.test("matchesIdempotencyRef: substring collision is rejected", () => {
  const instructions = "Ref: abc-123";
  assertEquals(matchesIdempotencyRef(instructions, "abc"), false);
});

Deno.test("matchesIdempotencyRef: null/empty inputs", () => {
  assertEquals(matchesIdempotencyRef(null, "x"), false);
  assertEquals(matchesIdempotencyRef("Ref: x", ""), false);
});

Deno.test("findJobberJobByIdempotencyKey: matched on first page", async () => {
  const graphql = async () => ({
    data: {
      jobs: {
        nodes: [
          { id: "J1", jobNumber: 42, instructions: "unrelated", visits: { nodes: [] } },
          {
            id: "J2",
            jobNumber: 43,
            instructions: "line1\nRef: KEY-XYZ\nline3",
            visits: { nodes: [{ id: "V9" }] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  });
  const r = await findJobberJobByIdempotencyKey({
    idempotencyKey: "KEY-XYZ",
    createdAfter: new Date("2026-07-01"),
    graphql: graphql as any,
  });
  assertEquals(r.outcome, "matched");
  if (r.outcome === "matched") {
    assertEquals(r.jobberJobId, "J2");
    assertEquals(r.jobberVisitId, "V9");
    assertEquals(r.referenceNumber, "43");
  }
});

Deno.test("findJobberJobByIdempotencyKey: not_found after bounded scan", async () => {
  const graphql = async () => ({
    data: {
      jobs: {
        nodes: [{ id: "J1", jobNumber: 1, instructions: "nope", visits: { nodes: [] } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  });
  const r = await findJobberJobByIdempotencyKey({
    idempotencyKey: "KEY-XYZ",
    createdAfter: new Date("2026-07-01"),
    graphql: graphql as any,
  });
  assertEquals(r.outcome, "not_found");
});

Deno.test("findJobberJobByIdempotencyKey: throttle returns error", async () => {
  const graphql = async () => ({ throttled: true, errors: [{ message: "throttled" }] });
  const r = await findJobberJobByIdempotencyKey({
    idempotencyKey: "KEY-XYZ",
    createdAfter: new Date("2026-07-01"),
    graphql: graphql as any,
  });
  assertEquals(r.outcome, "error");
  if (r.outcome === "error") assertEquals(r.throttled, true);
});

Deno.test("findJobberJobByIdempotencyKey: exhausted page budget → error", async () => {
  let called = 0;
  const graphql = async () => {
    called++;
    return {
      data: {
        jobs: {
          nodes: [{ id: `J${called}`, jobNumber: called, instructions: "nope", visits: { nodes: [] } }],
          pageInfo: { hasNextPage: true, endCursor: `cur${called}` },
        },
      },
    };
  };
  const r = await findJobberJobByIdempotencyKey({
    idempotencyKey: "KEY-XYZ",
    createdAfter: new Date("2026-07-01"),
    graphql: graphql as any,
    maxPages: 2,
  });
  assertEquals(r.outcome, "error");
  assertEquals(called, 2);
});
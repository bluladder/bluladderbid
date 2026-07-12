import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DELETE_VISIT_MUTATION,
  interpretVisitDelete,
  isAlreadyGoneMessage,
  type VisitDeleteResult,
} from "./jobberCancellation.ts";

// 1. Correct plural mutation is used, old singular form is gone.
Deno.test("mutation uses plural visitIds and VisitDeletePayload shape", () => {
  assert(DELETE_VISIT_MUTATION.includes("visitDelete(visitIds: $visitIds)"));
  assert(DELETE_VISIT_MUTATION.includes("$visitIds: [EncodedId!]!"));
  assert(DELETE_VISIT_MUTATION.includes("visits {"));
  assert(DELETE_VISIT_MUTATION.includes("userErrors {"));
  // The removed legacy field must never reappear.
  assert(!DELETE_VISIT_MUTATION.includes("deletedVisitId"));
  assert(!DELETE_VISIT_MUTATION.includes("visitId:"));
});

// 2. Clean success => confirmed.
Deno.test("empty userErrors => confirmed", () => {
  const r: VisitDeleteResult = { data: { visitDelete: { visits: [{ id: "v1" }], userErrors: [] } } };
  assertEquals(interpretVisitDelete(r).outcome, "confirmed");
});

Deno.test("success with echoed visits and no userErrors => confirmed", () => {
  const r: VisitDeleteResult = { data: { visitDelete: { visits: [{ id: "v1" }], userErrors: [] } } };
  assertEquals(interpretVisitDelete(r).outcome, "confirmed");
});

// 3. HTTP 200 with GraphQL userErrors => fail closed.
Deno.test("userErrors present => failed (fail closed)", () => {
  const r: VisitDeleteResult = {
    data: { visitDelete: { visits: null, userErrors: [{ message: "You are not authorized" }] } },
  };
  const out = interpretVisitDelete(r);
  assertEquals(out.outcome, "failed");
  assert(out.reason?.includes("not authorized"));
});

// 4. Jobber outage / transport error => fail closed.
Deno.test("top-level errors => failed", () => {
  const r: VisitDeleteResult = { errors: [{ message: "API error: 502" }] };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

// Live Jobber (2025-04-16) returns "Visit does not exist" as a TOP-LEVEL error
// (not a userError) when the visit was already removed. This must be idempotent
// success, otherwise a retry / already-cancelled-in-Jobber case falsely flags
// the booking as needs_attention.
Deno.test("top-level 'Visit does not exist' error => already_gone", () => {
  const r: VisitDeleteResult = {
    data: null,
    errors: [{ message: "Visit does not exist" }],
  };
  assertEquals(interpretVisitDelete(r).outcome, "already_gone");
});

Deno.test("mixed top-level errors (one real) => failed (not all gone)", () => {
  const r: VisitDeleteResult = {
    data: null,
    errors: [{ message: "Visit does not exist" }, { message: "Internal server error" }],
  };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

Deno.test("throttled => failed", () => {
  const r: VisitDeleteResult = { throttled: true, errors: [{ message: "rate limited" }] };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

// 5. Malformed responses => fail closed.
Deno.test("null result => failed", () => {
  assertEquals(interpretVisitDelete(null).outcome, "failed");
});

Deno.test("missing visitDelete payload => failed", () => {
  const r: VisitDeleteResult = { data: {} };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

Deno.test("data null => failed", () => {
  const r: VisitDeleteResult = { data: null };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

// 8. Already-deleted visit => idempotent success (already_gone).
Deno.test("not-found userError => already_gone", () => {
  const r: VisitDeleteResult = {
    data: { visitDelete: { visits: null, userErrors: [{ message: "Visit not found" }] } },
  };
  assertEquals(interpretVisitDelete(r).outcome, "already_gone");
});

Deno.test("mixed real + not-found userErrors => failed (not all gone)", () => {
  const r: VisitDeleteResult = {
    data: {
      visitDelete: {
        visits: null,
        userErrors: [{ message: "Visit not found" }, { message: "Permission denied" }],
      },
    },
  };
  assertEquals(interpretVisitDelete(r).outcome, "failed");
});

Deno.test("isAlreadyGoneMessage matches common phrasings", () => {
  assert(isAlreadyGoneMessage("Visit not found"));
  assert(isAlreadyGoneMessage("Couldn't find Visit"));
  assert(isAlreadyGoneMessage("This visit no longer exists"));
  assert(isAlreadyGoneMessage("Record has been deleted"));
  assert(!isAlreadyGoneMessage("Permission denied"));
  assert(!isAlreadyGoneMessage(""));
});

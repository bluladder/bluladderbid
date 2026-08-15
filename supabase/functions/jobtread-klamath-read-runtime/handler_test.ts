// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { JobTreadExecutionResult } from "../_shared/jobtreadExecutionRunner.ts";
import { createKlamathJobTreadReadHandler } from "./handler.ts";

const EXECUTION_REFERENCE = "owner_acceptance_001";

function healthBody(extra: Record<string, unknown> = {}) {
  return {
    capability: "health",
    executionReference: EXECUTION_REFERENCE,
    ...extra,
  };
}

function okResult(): JobTreadExecutionResult {
  return {
    status: "ok",
    value: {
      step: "grant_membership_read",
      recordCount: 1,
      nextPagePresent: false,
    },
    audit: {
      organizationId: "private_organization",
      connectorId: "private_connector",
      capability: "health",
      configurationVersion: 1,
      requestFingerprint: "private_fingerprint",
      idempotencyKeyHash: null,
      attemptNumber: null,
      outcomeUncertain: false,
    },
  };
}

Deno.test("unauthorized calls stop before request parsing", async () => {
  let executed = false;
  const handler = createKlamathJobTreadReadHandler({
    authorize: () => Promise.resolve(false),
    execute() {
      executed = true;
      return Promise.resolve(okResult());
    },
  });
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      body: "not-json",
    }),
  );
  assertEquals(response.status, 401);
  assertFalse(executed);
});

Deno.test("handler returns only sanitized health evidence", async () => {
  const handler = createKlamathJobTreadReadHandler({
    authorize: () => Promise.resolve(true),
    execute: () => Promise.resolve(okResult()),
  });
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(healthBody()),
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, {
    status: "ok",
    capability: "health",
    outcome: {
      step: "grant_membership_read",
      recordCount: 1,
      nextPagePresent: false,
    },
  });
  const serialized = JSON.stringify(body);
  for (
    const forbidden of [
      "private_organization",
      "private_connector",
      "private_fingerprint",
      "audit",
    ]
  ) assertFalse(serialized.includes(forbidden));
});

Deno.test("handler rejects write and extra-field requests", async () => {
  let executions = 0;
  const handler = createKlamathJobTreadReadHandler({
    authorize: () => Promise.resolve(true),
    execute() {
      executions += 1;
      return Promise.resolve(okResult());
    },
  });
  for (
    const body of [
      {
        capability: "customer_sync",
        executionReference: EXECUTION_REFERENCE,
      },
      healthBody({ organizationId: "caller_supplied" }),
    ]
  ) {
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assertEquals(response.status, 400);
  }
  assertEquals(executions, 0);
});

Deno.test("handler enforces the byte cap without trusting content-length", async () => {
  let executions = 0;
  const handler = createKlamathJobTreadReadHandler({
    authorize: () => Promise.resolve(true),
    execute() {
      executions += 1;
      return Promise.resolve(okResult());
    },
  });

  const oversized = new Request("https://example.test", {
    method: "POST",
    body: `{"padding":"${"x".repeat(4_096)}"}`,
  });
  assertEquals(oversized.headers.get("content-length"), null);
  const oversizedResponse = await handler(oversized);
  assertEquals(oversizedResponse.status, 413);

  const invalidLengthResponse = await handler(
    new Request(
      "https://example.test",
      {
        method: "POST",
        headers: { "content-length": "not-a-number" },
        body: JSON.stringify(healthBody()),
      },
    ),
  );
  assertEquals(invalidLengthResponse.status, 400);
  assertEquals(executions, 0);
});

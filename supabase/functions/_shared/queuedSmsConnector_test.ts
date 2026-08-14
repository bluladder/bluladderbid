// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DFW_CALLRAIL_CREDENTIAL_REFERENCE,
  DFW_CALLRAIL_SENDER_REFERENCE,
} from "./smsOutbox.ts";
import { authorizeQueuedSmsConnector } from "./queuedSmsConnector.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectorId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";

function makeSupabase(input: {
  connector?: "active" | "missing";
  bind?: "ok" | "stale" | "wrong_org";
  log?: any[];
}) {
  const log = input.log ?? [];
  return {
    from(table: string) {
      if (table === "organization_messaging_connectors") {
        const chain: any = {
          eq(column: string, value: unknown) {
            log.push({ action: "connector_filter", column, value });
            return chain;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({
              data: input.connector === "missing" ? [] : [{
                id: connectorId,
                organization_id: organizationId,
                channel: "sms",
                provider: "callrail",
                status: "active",
                priority: 10,
                credential_reference: DFW_CALLRAIL_CREDENTIAL_REFERENCE,
                sender_identity_reference: DFW_CALLRAIL_SENDER_REFERENCE,
              }],
              error: null,
            }).then(resolve);
          },
        };
        return { select: () => chain };
      }
      if (table !== "sms_messages") throw new Error(`unexpected:${table}`);
      return {
        update(values: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const chain: any = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            is(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            select() {
              return chain;
            },
            maybeSingle() {
              log.push({ action: "bind", values, filters });
              if (input.bind === "stale") {
                return Promise.resolve({ data: null, error: null });
              }
              return Promise.resolve({
                data: {
                  id: "message-1",
                  organization_id: input.bind === "wrong_org"
                    ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                    : organizationId,
                  messaging_connector_id: connectorId,
                  channel: "sms",
                  outbound_idempotency_key: "queue:message-1",
                },
                error: null,
              });
            },
          };
          return chain;
        },
      };
    },
  } as any;
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    organization_id: organizationId,
    messaging_connector_id: null,
    send_claim_token: claimToken,
    outbound_idempotency_key: "queue:message-1",
    ...overrides,
  };
}

Deno.test("queued connector authority binds an unbound claimed SMS", async () => {
  const log: any[] = [];
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ log }),
    message(),
  );
  assertEquals(result.status, "authorized");
  const bind = log.find((entry) => entry.action === "bind");
  assertEquals(bind.values.messaging_connector_id, connectorId);
  assertEquals(bind.filters.organization_id, organizationId);
  assertEquals(bind.filters.send_claim_token, claimToken);
  assertEquals(bind.filters.outbox_state, "pending_send");
  assertEquals(bind.filters.messaging_connector_id, null);
});

Deno.test("queued connector authority rejects missing organization", async () => {
  const log: any[] = [];
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ log }),
    message({ organization_id: null }),
  );
  assertEquals(result, { status: "blocked", reason: "organization_missing" });
  assertEquals(log.length, 0);
});

Deno.test("queued connector authority rejects a persisted connector mismatch", async () => {
  const log: any[] = [];
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ log }),
    message({
      messaging_connector_id: "44444444-4444-4444-8444-444444444444",
    }),
  );
  assertEquals(result, {
    status: "blocked",
    reason: "connector_lineage_mismatch",
  });
  assertEquals(log.some((entry) => entry.action === "bind"), false);
});

Deno.test("queued connector authority rejects missing connector", async () => {
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ connector: "missing" }),
    message(),
  );
  assertEquals(result, { status: "blocked", reason: "connector_missing" });
});

Deno.test("queued connector authority rejects a stale claim", async () => {
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ bind: "stale" }),
    message(),
  );
  assertEquals(result, {
    status: "blocked",
    reason: "connector_binding_failed",
  });
});

Deno.test("queued connector authority rechecks bound organization", async () => {
  const result = await authorizeQueuedSmsConnector(
    makeSupabase({ bind: "wrong_org" }),
    message(),
  );
  assertEquals(result, {
    status: "blocked",
    reason: "organization_lineage_mismatch",
  });
});

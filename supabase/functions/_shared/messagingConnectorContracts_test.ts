import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  guardMessagingDispatch,
  type OrganizationMessagingConnectorConfig,
  selectOrganizationMessagingConnector,
} from "./messagingConnectorContracts.ts";

const DFW = "b1addf00-0000-4000-8000-000000000001";
const KLAMATH = "b1addf00-0000-4000-8000-000000000002";

function connector(
  patch: Partial<OrganizationMessagingConnectorConfig> = {},
): OrganizationMessagingConnectorConfig {
  return {
    id: "connector-dfw-sms",
    organizationId: DFW,
    channel: "sms",
    provider: "callrail",
    status: "active",
    priority: 100,
    credentialReference: "dfw-callrail-credential",
    senderIdentityReference: "dfw-public-sender",
    ...patch,
  };
}

Deno.test("messaging connector resolves one exact organization sender", () => {
  const selected = selectOrganizationMessagingConnector(DFW, "sms", [
    connector(),
    connector({
      id: "connector-klamath-sms",
      organizationId: KLAMATH,
      provider: "twilio",
      credentialReference: "klamath-twilio-credential",
      senderIdentityReference: "klamath-public-sender",
    }),
  ]);
  assertEquals(selected.status, "resolved");
  if (selected.status === "resolved") {
    assertEquals(selected.connector.id, "connector-dfw-sms");
  }
});

Deno.test("messaging connector never falls back across organizations", () => {
  assertEquals(
    selectOrganizationMessagingConnector(KLAMATH, "sms", [connector()]),
    {
      status: "blocked",
      code: "connector_missing",
      candidateConnectorIds: [],
    },
  );
});

Deno.test("inactive, ambiguous, and incomplete senders fail closed", () => {
  assertEquals(
    selectOrganizationMessagingConnector(DFW, "sms", [
      connector({ status: "inactive" }),
    ]).status,
    "blocked",
  );
  assertEquals(
    selectOrganizationMessagingConnector(DFW, "sms", [
      connector(),
      connector({ id: "connector-dfw-sms-peer" }),
    ]),
    {
      status: "blocked",
      code: "connector_ambiguous",
      candidateConnectorIds: [
        "connector-dfw-sms",
        "connector-dfw-sms-peer",
      ],
    },
  );
  assertEquals(
    selectOrganizationMessagingConnector(DFW, "sms", [
      connector({ credentialReference: null }),
    ]).status,
    "blocked",
  );
  assertEquals(
    selectOrganizationMessagingConnector(DFW, "sms", [
      connector({ senderIdentityReference: null }),
    ]).status,
    "blocked",
  );
});

Deno.test("dispatch guard binds organization, connector, channel, and key", () => {
  const selected = connector();
  assertEquals(
    guardMessagingDispatch(selected, {
      organizationId: DFW,
      connectorId: selected.id,
      channel: "sms",
      idempotencyKey: "quote:one",
    }),
    { status: "authorized" },
  );
  assertEquals(
    guardMessagingDispatch(selected, {
      organizationId: KLAMATH,
      connectorId: selected.id,
      channel: "sms",
      idempotencyKey: "quote:one",
    }),
    { status: "blocked", code: "organization_lineage_mismatch" },
  );
  assertEquals(
    guardMessagingDispatch(selected, {
      organizationId: DFW,
      connectorId: selected.id,
      channel: "email",
      idempotencyKey: "quote:one",
    }),
    { status: "blocked", code: "channel_mismatch" },
  );
  assertEquals(
    guardMessagingDispatch(selected, {
      organizationId: DFW,
      connectorId: selected.id,
      channel: "sms",
      idempotencyKey: " ",
    }),
    { status: "blocked", code: "idempotency_key_missing" },
  );
});

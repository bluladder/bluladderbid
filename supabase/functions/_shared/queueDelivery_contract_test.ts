import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const processor = await Deno.readTextFile(
  new URL("../process-sms-queue/index.ts", import.meta.url),
);
const queuedConnector = await Deno.readTextFile(
  new URL("./queuedSmsConnector.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20260729235016_launch_recurring_recovery.sql",
    import.meta.url,
  ),
);

Deno.test("ordinary queue claims are durable before provider dispatch", () => {
  assert(migration.includes("outbox_state = 'pending_send'"));
  assert(migration.includes("send_claim_token = gen_random_uuid()"));
  assert(migration.includes("'queue:' || m.id::text"));
  assert(migration.includes("FOR UPDATE SKIP LOCKED"));
});

Deno.test("stale queue claims become uncertain and cannot be reclaimed", () => {
  assert(migration.includes("outbox_state = 'delivery_unknown'"));
  assert(
    migration.includes("stale_queue_claim_provider_result_unknown"),
  );
  assertEquals(
    migration.includes("SET status = 'pending', updated_at = now()"),
    false,
  );
  assert(migration.includes("Recovered stale pre-submission queue claim"));
  assert(
    migration.includes("legacy_stale_queue_claim_provider_result_unknown"),
  );
});

Deno.test("worker finalization is claim-token compare-and-set", () => {
  assert(processor.includes('.eq("send_claim_token", msg.send_claim_token)'));
  assert(processor.includes('.eq("outbox_state", expectedState)'));
  assert(processor.includes("begin_queued_communication_submission"));
  assertEquals(
    processor.includes('from("sms_messages").update('),
    false,
  );
});

Deno.test("queued SMS binds and rechecks organization connector before dispatch", () => {
  assert(processor.includes("authorizeQueuedSmsConnector"));
  assert(queuedConnector.includes("selectSmsConnector"));
  assert(
    queuedConnector.includes(
      "messaging_connector_id: selection.connector.id",
    ),
  );
  assert(
    queuedConnector.includes('eq("send_claim_token", msg.send_claim_token)'),
  );
  assert(queuedConnector.includes('eq("outbox_state", "pending_send")'));
  assert(queuedConnector.includes("guardMessagingDispatch"));
  assert(processor.includes("dispatchSelectedSmsConnector"));
  assertEquals(processor.includes("sendCallRailSms"), false);
  assertEquals(processor.includes("getCallRailConfig"), false);

  const bind = queuedConnector.indexOf(
    "messaging_connector_id: selection.connector.id",
  );
  const authorize = processor.lastIndexOf(
    "authorizeQueuedSmsConnector(supabase, msg)",
  );
  const begin = processor.lastIndexOf("beginProviderSubmission(supabase, msg)");
  const dispatch = processor.lastIndexOf("dispatchSelectedSmsConnector(");
  assert(bind >= 0 && authorize >= 0 && begin > authorize && dispatch > begin);
});

Deno.test("unscoped or mismatched queued SMS fails closed before provider boundary", () => {
  assert(queuedConnector.includes('reason: "organization_missing"'));
  assert(queuedConnector.includes('reason: "connector_lineage_mismatch"'));
  assert(queuedConnector.includes('reason: "connector_binding_failed"'));
  const blocked = processor.indexOf("SMS connector blocked");
  assert(blocked >= 0);
  assert(processor.slice(blocked, blocked + 180).includes("true,"));
});

Deno.test("unknown delivery requires explicit service-role reconciliation", () => {
  assert(migration.includes("reconcile_queued_communication_delivery"));
  assert(migration.includes("'confirmed_not_sent'"));
  assert(migration.includes("'provider_id_required'"));
  assert(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.reconcile_queued_communication_delivery",
    ),
  );
});

Deno.test("email gets stable provider idempotency and uncertainty is terminal", () => {
  assert(
    processor.includes(
      "idempotencyKey: queuedProviderIdempotencyKey(msg)",
    ),
  );
  assert(processor.includes("emailFailureOutcome"));
  assert(processor.includes("smsFailureOutcome"));
  assert(processor.includes("email_provider_result_uncertain"));
  assert(processor.includes("sms_provider_result_uncertain"));
});

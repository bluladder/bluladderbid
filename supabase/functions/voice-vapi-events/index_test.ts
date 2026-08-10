import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleVapiEventRequest } from "./index.ts";

const SECRET = "test-vapi-secret-abcdef";
const LEGACY_SECRET = "legacy-fixture";

function setEnv(k: string, v: string | null) {
  if (v === null) Deno.env.delete(k);
  else Deno.env.set(k, v);
}

function setLegacySecret(secret: string | null) {
  setEnv("VAPI_SERVER_SECRET_SHA256", null);
  setEnv("VAPI_SERVER_SECRET", secret);
}

function setDigestSecret(digest: string, legacySecret: string | null = null) {
  setEnv("VAPI_SERVER_SECRET_SHA256", digest);
  setEnv("VAPI_SERVER_SECRET", legacySecret);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://local/voice-vapi-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("event receiver: missing production secret fails closed", async () => {
  setLegacySecret(null);
  const res = await handleVapiEventRequest(post({ message: { type: "hang" } }));
  assertEquals(res.status, 500);
  await res.text();
});

Deno.test("event receiver: accepts the correct token through the normalized SHA-256 digest", async () => {
  const digest = await sha256Hex(SECRET);
  setDigestSecret(`  ${digest.toUpperCase()}  `);
  const res = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).received, true);
});

Deno.test("event receiver: rejects an incorrect token when digest auth is configured", async () => {
  setDigestSecret(await sha256Hex(SECRET));
  const res = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": "incorrect-token" },
  ));
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("event receiver: malformed digest fails closed without plaintext fallback", async () => {
  setDigestSecret("not-a-valid-sha256-digest", SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, "shared_secret_digest_invalid");
});

Deno.test("event receiver: digest configuration takes precedence over plaintext", async () => {
  setDigestSecret(await sha256Hex(SECRET), LEGACY_SECRET);
  const legacyRes = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": LEGACY_SECRET },
  ));
  assertEquals(legacyRes.status, 401);
  await legacyRes.text();

  const digestRes = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(digestRes.status, 200);
  await digestRes.text();
});

Deno.test("event receiver: plaintext secret remains a deployment fallback when digest is absent", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "assistant.started" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 200);
  await res.text();
});

Deno.test("event receiver: 405 on unsupported method", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(
    new Request("http://local/voice-vapi-events", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  await res.text();
});

Deno.test("event receiver: 415 on non-json content type", async () => {
  setLegacySecret(SECRET);
  const req = new Request("http://local/voice-vapi-events", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "x-vapi-secret": SECRET },
    body: "hi",
  });
  const res = await handleVapiEventRequest(req);
  assertEquals(res.status, 415);
  await res.text();
});

Deno.test("event receiver: 401 on missing auth", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(post({ message: { type: "hang" } }));
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("event receiver: 401 on invalid auth", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "hang" } },
    { "x-vapi-secret": "wrong" },
  ));
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("event receiver: 413 on oversized body", async () => {
  setLegacySecret(SECRET);
  const big = "x".repeat(70 * 1024);
  const res = await handleVapiEventRequest(post(JSON.stringify({ big }), {
    "x-vapi-secret": SECRET,
  }));
  assertEquals(res.status, 413);
  await res.text();
});

Deno.test("event receiver: recognized informational event returns 200", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "status-update" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.received, true);
  assertEquals(body.eventType, "status-update");
});

Deno.test("event receiver: unsupported event type is safely ignored", async () => {
  setLegacySecret(SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "transfer-destination-request" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.received, false);
  assertEquals(body.ignored, true);
});

Deno.test("event receiver: authenticated tool call returns Vapi's exact results shape", async () => {
  setLegacySecret(SECRET);
  let calls = 0;
  const res = await handleVapiEventRequest(
    post({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "tool-1", name: "send_online_quote_link" }],
        call: {
          id: "call-1",
          assistantId: "mapped-assistant",
          customer: { number: "+14697472877" },
        },
      },
    }, { "x-vapi-secret": SECRET }),
    {
      organizationId: "00000000-0000-4000-8000-000000000091",
      handleLinkTools: (_supabase, input) => {
        calls++;
        assertEquals(
          input.organizationId,
          "00000000-0000-4000-8000-000000000091",
        );
        return Promise.resolve({
          results: [{
            toolCallId: "tool-1",
            result: JSON.stringify({
              status: "provider_accepted",
              message: "provider accepted",
            }),
          }],
        });
      },
    },
  );
  assertEquals(res.status, 200);
  assertEquals(calls, 1);
  assertEquals(await res.json(), {
    results: [{
      toolCallId: "tool-1",
      result: JSON.stringify({
        status: "provider_accepted",
        message: "provider accepted",
      }),
    }],
  });
});

Deno.test("event receiver: routes the exact human-transfer tool without invoking a link delivery", async () => {
  setLegacySecret(SECRET);
  let transfers = 0;
  let links = 0;
  const res = await handleVapiEventRequest(
    post({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "transfer-1", name: "request_human_transfer" }],
        call: {
          id: "call-1",
          assistantId: "mapped-assistant",
          customer: { number: "+14697472877" },
          monitor: { controlUrl: "https://api.vapi.ai/call/call-1" },
        },
      },
    }, { "x-vapi-secret": SECRET }),
    {
      organizationId: "00000000-0000-4000-8000-000000000091",
      handleHumanTransfer: (_supabase, input) => {
        transfers++;
        assertEquals(
          input.organizationId,
          "00000000-0000-4000-8000-000000000091",
        );
        return Promise.resolve({
          results: [{
            toolCallId: "transfer-1",
            result: JSON.stringify({
              status: "transfer_requested",
              message: "provider accepted transfer control",
            }),
          }],
        });
      },
      handleLinkTools: () => {
        links++;
        return Promise.resolve({ results: [] });
      },
    },
  );
  assertEquals(res.status, 200);
  assertEquals(transfers, 1);
  assertEquals(links, 0);
  const response = await res.json();
  assertEquals(
    JSON.parse(response.results[0].result).status,
    "transfer_requested",
  );
});

Deno.test("event receiver: missing tool tenant authority fails closed without executing delivery", async () => {
  setLegacySecret(SECRET);
  let deliveries = 0;
  const res = await handleVapiEventRequest(
    post({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "tool-1", name: "send_online_quote_link" }],
        call: { id: "call-1", customer: { number: "+14697472877" } },
      },
    }, { "x-vapi-secret": SECRET }),
    {
      handleLinkTools: (_supabase, input) => {
        deliveries++;
        return Promise.resolve({
          results: [{
            toolCallId: "tool-1",
            result: JSON.stringify({
              status: input.organizationId
                ? "provider_accepted"
                : "invalid_request",
              message: "authority required",
            }),
          }],
        });
      },
    },
  );
  assertEquals(res.status, 200);
  assertEquals(deliveries, 1);
  const response = await res.json();
  assertEquals(
    JSON.parse(response.results[0].result).status,
    "invalid_request",
  );
});

Deno.test("event receiver: tool diagnostics expose only bounded status evidence", async () => {
  setLegacySecret(SECRET);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(String(msg));
  try {
    const res = await handleVapiEventRequest(
      post({
        message: {
          type: "tool-calls",
          toolCallList: [{
            id: "private-tool-call-id",
            name: "send_online_quote_link",
          }],
          call: {
            id: "private-call-id",
            assistantId: "private-assistant-id",
            customer: { number: "+14697472877" },
          },
        },
      }, { "x-vapi-secret": SECRET }),
      {
        organizationId: "00000000-0000-4000-8000-000000000091",
        handleLinkTools: () =>
          Promise.resolve({
            results: [{
              toolCallId: "private-tool-call-id",
              result: JSON.stringify({
                status: "provider_accepted",
                message: "provider accepted",
              }),
            }],
          }),
      },
    );
    assertEquals(res.status, 200);
    await res.text();
  } finally {
    console.log = originalLog;
  }

  const joined = logs.join("\n");
  assert(joined.includes('"toolStatuses":["provider_accepted"]'));
  assert(!joined.includes("private-tool-call-id"));
  assert(!joined.includes("private-call-id"));
  assert(!joined.includes("private-assistant-id"));
  assert(!joined.includes("+14697472877"));
});

Deno.test("event receiver: rejected tool envelope logs structural counts without identifiers or PII", async () => {
  setLegacySecret(SECRET);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(String(msg));
  try {
    const res = await handleVapiEventRequest(
      post({
        message: {
          type: "tool-calls",
          toolCallList: [{
            id: "private-rejected-tool-id",
            function: {
              arguments: JSON.stringify({ phone: "+14697472877" }),
            },
          }],
          call: {
            id: "private-rejected-call-id",
            customer: { number: "+14697472877" },
          },
        },
      }, { "x-vapi-secret": SECRET }),
      {
        organizationId: "00000000-0000-4000-8000-000000000091",
        handleLinkTools: () => Promise.resolve({ results: [] }),
      },
    );
    assertEquals(res.status, 200);
    await res.text();
  } finally {
    console.log = originalLog;
  }

  const joined = logs.join("\n");
  assert(joined.includes('"toolResults":0'));
  assert(joined.includes('"directCount":1'));
  assert(joined.includes('"directWithId":1'));
  assert(!joined.includes("private-rejected-tool-id"));
  assert(!joined.includes("private-rejected-call-id"));
  assert(!joined.includes("+14697472877"));
});

Deno.test("event receiver: logs redact token, digest, auth headers, identifiers, transcript, and phone", async () => {
  const digest = await sha256Hex(SECRET);
  setDigestSecret(digest);
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (msg: string) => {
    logs.push(String(msg));
  };
  console.warn = (msg: string) => {
    logs.push(String(msg));
  };
  try {
    const res = await handleVapiEventRequest(
      post(
        {
          message: {
            type: "end-of-call-report",
            call: { id: "call_abc", customer: { number: "+14697472877" } },
            transcript: "SECRET TRANSCRIPT CONTENT",
            summary: "SECRET SUMMARY",
          },
        },
        {
          "x-vapi-secret": SECRET,
          "authorization": "Bearer SECRET-BEARER-TOKEN",
          "x-vapi-credential-id": "SECRET-CREDENTIAL-ID",
        },
      ),
      { runHangupFollowup: () => Promise.resolve({ status: "missing_phone" }) },
    );
    assertEquals(res.status, 200);
    await res.text();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  const joined = logs.join("\n");
  assert(!joined.includes("SECRET TRANSCRIPT CONTENT"));
  assert(!joined.includes("SECRET SUMMARY"));
  assert(!joined.includes("+14697472877"));
  assert(!joined.includes("SECRET-BEARER-TOKEN"));
  assert(!joined.includes("SECRET-CREDENTIAL-ID"));
  assert(!joined.includes(SECRET));
  assert(!joined.includes(digest));
});

Deno.test("event receiver: final call-ended event runs the bid-link follow-up once", async () => {
  setLegacySecret(SECRET);
  let calls = 0;
  const res = await handleVapiEventRequest(
    post({ message: { type: "end-of-call-report", call: { id: "call_1" } } }, {
      "x-vapi-secret": SECRET,
    }),
    {
      runHangupFollowup: () => {
        calls++;
        return Promise.resolve({ status: "sent" });
      },
    },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(calls, 1);
  assertEquals(body.followup.status, "sent");
});

Deno.test("event receiver: final event runs one local post-call note path without a provider memo", async () => {
  setLegacySecret(SECRET);
  let notes = 0;
  const res = await handleVapiEventRequest(
    post({ message: { type: "end-of-call-report", call: { id: "call_1" } } }, {
      "x-vapi-secret": SECRET,
    }),
    {
      organizationId: "00000000-0000-4000-8000-000000000072",
      persistPostCallNote: () => {
        notes++;
        return Promise.resolve({
          status: "persisted",
          conversationId: "conversation-1",
          quoteSessionId: null,
          noteId: "note-1",
          providerMemoStatus: "disabled",
        });
      },
      runHangupFollowup: () => Promise.resolve({ status: "sent" }),
    },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(notes, 1);
  assertEquals(body.postCallNote.status, "persisted");
  assertEquals(body.postCallNote.providerMemoStatus, "disabled");
});

Deno.test("event receiver: non-final events never run the follow-up", async () => {
  setLegacySecret(SECRET);
  let calls = 0;
  for (const type of ["status-update", "hang", "assistant.started"]) {
    const res = await handleVapiEventRequest(
      post({ message: { type } }, { "x-vapi-secret": SECRET }),
      {
        runHangupFollowup: () => {
          calls++;
          return Promise.resolve({ status: "sent" });
        },
      },
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.followup, undefined);
  }
  assertEquals(calls, 0);
});

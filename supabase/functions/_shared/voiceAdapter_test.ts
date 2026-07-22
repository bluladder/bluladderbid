// Deno tests for the provider-independent voice adapter.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNonStreamingResponse,
  buildStreamingResponse,
  chunkReply,
  mapDispositionToAction,
  parseAdapterRequest,
  MAX_ADAPTER_REQUEST_BYTES,
  ensureVoiceConversation,
  type AdapterCompletion,
} from "./voiceAdapter.ts";
import {
  basicGreetingRequest,
  bookingRequestDryRun,
  humanTransferRequest,
  callbackRequest,
  uncertainPricingRequest,
  uncertainSchedulingRequest,
  gracefulEndingRequest,
  postCallSmsHandoffRequest,
  streamingRequest,
  malformedRequestJson,
  oversizedRequestBody,
} from "./__fixtures__/voice/requests.ts";

function makeReq(body: unknown, init: RequestInit = {}): Request {
  const b = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: b,
    ...init,
  });
}

Deno.test("parseAdapterRequest: valid OpenAI-compatible request", async () => {
  const parsed = await parseAdapterRequest(makeReq(basicGreetingRequest));
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.messages.length, 1);
  assertEquals(parsed.value.stream, false);
  assert(parsed.value.sessionIdIsSynthetic);
});

Deno.test("parseAdapterRequest: rejects unsupported method", async () => {
  const req = new Request("http://local/v1/chat/completions", { method: "GET" });
  const parsed = await parseAdapterRequest(req);
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "unsupported_method");
});

Deno.test("parseAdapterRequest: rejects unsupported content type", async () => {
  const req = new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "hello",
  });
  const parsed = await parseAdapterRequest(req);
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "unsupported_content_type");
});

Deno.test("parseAdapterRequest: rejects oversized body", async () => {
  const parsed = await parseAdapterRequest(makeReq(oversizedRequestBody));
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "too_large");
  assert(oversizedRequestBody.length > MAX_ADAPTER_REQUEST_BYTES);
});

Deno.test("parseAdapterRequest: rejects malformed JSON", async () => {
  const parsed = await parseAdapterRequest(makeReq(malformedRequestJson));
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "malformed_json");
});

Deno.test("parseAdapterRequest: rejects missing messages", async () => {
  const parsed = await parseAdapterRequest(makeReq({ model: "m" }));
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "missing_messages");
});

Deno.test("parseAdapterRequest: rejects empty conversation", async () => {
  const parsed = await parseAdapterRequest(makeReq({ messages: [{ role: "assistant", content: "hi" }] }));
  assert(!parsed.ok);
  if (!parsed.ok) assertEquals(parsed.error.kind, "empty_conversation");
});

Deno.test("parseAdapterRequest: caller-supplied session id is preferred", async () => {
  const req = new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bluladder-session-id": "call-1234" },
    body: JSON.stringify(basicGreetingRequest),
  });
  const parsed = await parseAdapterRequest(req);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.sessionId, "call-1234");
  assertEquals(parsed.value.sessionIdIsSynthetic, false);
});

Deno.test("parseAdapterRequest: Vapi body.call.id becomes stable session id", async () => {
  const req = makeReq({ ...basicGreetingRequest, call: { id: "abc-123-vapi" } });
  const parsed = await parseAdapterRequest(req);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.sessionId, "vapi_call:abc-123-vapi");
  assertEquals(parsed.value.sessionIdIsSynthetic, false);
});

Deno.test("parseAdapterRequest: header overrides body.call.id", async () => {
  const req = makeReq(
    { ...basicGreetingRequest, call: { id: "abc-123-vapi" } },
    { headers: { "Content-Type": "application/json", "x-bluladder-session-id": "override-1" } },
  );
  const parsed = await parseAdapterRequest(req);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.sessionId, "override-1");
});

Deno.test("parseAdapterRequest: two turns from same Vapi call share sessionId", async () => {
  const a = await parseAdapterRequest(makeReq({ ...basicGreetingRequest, call: { id: "same-call" } }));
  const b = await parseAdapterRequest(makeReq({ ...basicGreetingRequest, call: { id: "same-call" } }));
  assert(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assertEquals(a.value.sessionId, b.value.sessionId);
  assertEquals(a.value.sessionIdIsSynthetic, false);
});

Deno.test("ensureVoiceConversation: reuses existing voice conversation by session token", async () => {
  let inserted = false;
  const supabase: any = {
    from(table: string) {
      assertEquals(table, "chat_conversations");
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => ({ data: { id: "conv_existing", session_token: "call-1234" }, error: null }),
        insert() { inserted = true; return this; },
        single: async () => ({ data: null, error: null }),
      };
    },
  };
  const parsed = await parseAdapterRequest(makeReq(basicGreetingRequest, { headers: { "Content-Type": "application/json", "x-bluladder-session-id": "call-1234" } }));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const got = await ensureVoiceConversation({ supabase, request: parsed.value });
  assertEquals(got.conversationId, "conv_existing");
  assertEquals(got.sessionToken, "call-1234");
  assertEquals(inserted, false);
});

Deno.test("ensureVoiceConversation: inserts a voice conversation for new sessions", async () => {
  let insertedBody: any = null;
  const supabase: any = {
    from(table: string) {
      assertEquals(table, "chat_conversations");
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
        insert(body: any) { insertedBody = body; return this; },
        single: async () => ({ data: { id: "conv_new", session_token: insertedBody.session_token }, error: null }),
      };
    },
  };
  const parsed = await parseAdapterRequest(makeReq(basicGreetingRequest, { headers: { "Content-Type": "application/json", "x-bluladder-session-id": "call-new" } }));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const got = await ensureVoiceConversation({ supabase, request: parsed.value });
  assertEquals(got.conversationId, "conv_new");
  assertEquals(insertedBody, { session_token: "call-new", channel: "voice" });
});

Deno.test("mapDispositionToAction: covers all nine voice dispositions", () => {
  const cases = [
    { d: { type: "speak" as const }, action: "speak" },
    { d: { type: "tool_result_speak" as const }, action: "tool_result_speak" },
    { d: { type: "transfer_human" as const, reason: "x" }, action: "request_transfer" },
    { d: { type: "callback_confirmed" as const }, action: "callback_captured" },
    { d: { type: "graceful_end" as const }, action: "end_call" },
    { d: { type: "safe_failure" as const, reasonCode: "x" }, action: "safe_failure" },
    { d: { type: "uncertain_pricing" as const }, action: "uncertain_pricing" },
    { d: { type: "uncertain_scheduling" as const }, action: "uncertain_scheduling" },
    { d: { type: "post_call_sms_handoff" as const }, action: "post_call_sms_handoff" },
  ];
  for (const c of cases) assertEquals(mapDispositionToAction(c.d).kind, c.action);
});

Deno.test("mapDispositionToAction: fails closed on missing disposition", () => {
  assertEquals(mapDispositionToAction(null).kind, "safe_failure");
  assertEquals(mapDispositionToAction(undefined).kind, "safe_failure");
});

Deno.test("chunkReply: handles empty and long input", () => {
  assertEquals(chunkReply(""), [""]);
  const long = "a".repeat(200);
  const chunks = chunkReply(long, 80);
  assertEquals(chunks.length, 3);
  assertEquals(chunks.join(""), long);
});

function fakeCompletion(overrides: Partial<AdapterCompletion> = {}): AdapterCompletion {
  return {
    content: "hello world",
    action: { kind: "speak" },
    orchestrator: { reply: "hello world", toolEvents: [], events: [], state: "new" },
    ...overrides,
  };
}

Deno.test("buildNonStreamingResponse: valid OpenAI-compatible JSON", async () => {
  const res = buildNonStreamingResponse("m", fakeCompletion());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.object, "chat.completion");
  assertEquals(body.choices[0].message.role, "assistant");
  assertEquals(body.choices[0].message.content, "hello world");
  assertEquals(body.choices[0].finish_reason, "stop");
  assertEquals(body.bluladder.action.kind, "speak");
});

Deno.test("buildStreamingResponse: emits chunks and terminates with [DONE]", async () => {
  const res = buildStreamingResponse("m", fakeCompletion({ content: "a".repeat(200) }));
  assertEquals(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  const text = await res.text();
  // Must include role delta, at least one content chunk, and a finish_reason chunk
  assert(text.includes(`"delta":{"role":"assistant"}`));
  assert(text.includes(`"delta":{"content":`));
  assert(text.includes(`"finish_reason":"stop"`));
  // SSE terminator, exactly as required.
  assert(text.endsWith("data: [DONE]\n\n"));
});

// Sanity fixtures used by higher-level integration checks.
Deno.test("fixtures parse successfully", async () => {
  for (const body of [
    bookingRequestDryRun,
    humanTransferRequest,
    callbackRequest,
    uncertainPricingRequest,
    uncertainSchedulingRequest,
    gracefulEndingRequest,
    postCallSmsHandoffRequest,
    streamingRequest,
  ]) {
    const parsed = await parseAdapterRequest(makeReq(body));
    assert(parsed.ok, `${JSON.stringify(body).slice(0, 40)}...`);
  }
});
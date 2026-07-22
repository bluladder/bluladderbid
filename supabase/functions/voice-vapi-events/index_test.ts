import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleVapiEventRequest } from "./index.ts";

const SECRET = "test-vapi-secret-abcdef";

function setEnv(k: string, v: string | null) {
  if (v === null) Deno.env.delete(k);
  else Deno.env.set(k, v);
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://local/voice-vapi-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("event receiver: missing production secret fails closed", async () => {
  setEnv("VAPI_SERVER_SECRET", null);
  const res = await handleVapiEventRequest(post({ message: { type: "hang" } }));
  assertEquals(res.status, 500);
  await res.text();
});

Deno.test("event receiver: 405 on unsupported method", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const res = await handleVapiEventRequest(
    new Request("http://local/voice-vapi-events", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  await res.text();
});

Deno.test("event receiver: 415 on non-json content type", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
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
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const res = await handleVapiEventRequest(post({ message: { type: "hang" } }));
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("event receiver: 401 on invalid auth", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "hang" } },
    { "x-vapi-secret": "wrong" },
  ));
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("event receiver: 413 on oversized body", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const big = "x".repeat(70 * 1024);
  const res = await handleVapiEventRequest(post(JSON.stringify({ big }), {
    "x-vapi-secret": SECRET,
  }));
  assertEquals(res.status, 413);
  await res.text();
});

Deno.test("event receiver: recognized informational event returns 200", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
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
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const res = await handleVapiEventRequest(post(
    { message: { type: "tool-calls" } },
    { "x-vapi-secret": SECRET },
  ));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.received, false);
  assertEquals(body.ignored, true);
});

Deno.test("event receiver: does not log transcript or full phone number", async () => {
  setEnv("VAPI_SERVER_SECRET", SECRET);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => { logs.push(String(msg)); };
  try {
    const res = await handleVapiEventRequest(post(
      {
        message: {
          type: "end-of-call-report",
          call: { id: "call_abc", customer: { number: "+14697472877" } },
          transcript: "SECRET TRANSCRIPT CONTENT",
          summary: "SECRET SUMMARY",
        },
      },
      { "x-vapi-secret": SECRET, "authorization": "Bearer SECRET-BEARER-TOKEN" },
    ));
    assertEquals(res.status, 200);
    await res.text();
  } finally {
    console.log = originalLog;
  }
  const joined = logs.join("\n");
  assert(!joined.includes("SECRET TRANSCRIPT CONTENT"));
  assert(!joined.includes("SECRET SUMMARY"));
  assert(!joined.includes("+14697472877"));
  assert(!joined.includes("SECRET-BEARER-TOKEN"));
});
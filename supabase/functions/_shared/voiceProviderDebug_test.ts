import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describePayloadShape,
  maskLast4,
  stableIdHash,
  summarizeChatCompletionRequest,
  summarizeVapiEvent,
  voiceProviderDebugEnabled,
} from "./voiceProviderDebug.ts";

Deno.test("debug flag: disabled by default", () => {
  assertEquals(voiceProviderDebugEnabled({ env: {} }), false);
  assertEquals(voiceProviderDebugEnabled({ env: { VOICE_PROVIDER_DEBUG: "false" } }), false);
});

Deno.test("debug flag: enabled only in non-production when explicitly true", () => {
  assertEquals(
    voiceProviderDebugEnabled({ env: { VOICE_PROVIDER_DEBUG: "true" } }),
    true,
  );
  assertEquals(
    voiceProviderDebugEnabled({ env: { VOICE_PROVIDER_DEBUG: "1", NODE_ENV: "development" } }),
    true,
  );
});

Deno.test("debug flag: refuses in production without explicit override", () => {
  assertEquals(
    voiceProviderDebugEnabled({ env: { VOICE_PROVIDER_DEBUG: "true", DENO_ENV: "production" } }),
    false,
  );
  assertEquals(
    voiceProviderDebugEnabled({
      env: {
        VOICE_PROVIDER_DEBUG: "true",
        DENO_ENV: "production",
        VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE: "true",
      },
    }),
    true,
  );
});

Deno.test("describePayloadShape: emits key paths and types only", () => {
  const { paths, types } = describePayloadShape({
    a: 1,
    b: { c: "hello", d: [true] },
    e: null,
  });
  assert(paths.includes("a"));
  assert(paths.includes("b.c"));
  assert(paths.includes("b.d"));
  assert(paths.includes("b.d[0]"));
  assert(paths.includes("e"));
  assertEquals(types["a"], "number");
  assertEquals(types["b.c"], "string");
  assertEquals(types["b.d"], "array");
  assertEquals(types["b.d[0]"], "boolean");
  assertEquals(types["e"], "null");
});

Deno.test("maskLast4: never returns full phone number", () => {
  assertEquals(maskLast4("+14697472877"), "***2877");
  assertEquals(maskLast4("469-747-2877"), "***2877");
  assertEquals(maskLast4("123"), null);
  assertEquals(maskLast4(undefined), null);
});

Deno.test("stableIdHash: deterministic and truncated", async () => {
  const a = await stableIdHash("call_1234");
  const b = await stableIdHash("call_1234");
  const c = await stableIdHash("call_9999");
  assertEquals(a, b);
  assert(a !== c);
  assertEquals(a.length, 16);
});

Deno.test("summarizeChatCompletionRequest: excludes message content", () => {
  const body = {
    model: "m",
    stream: true,
    user: "call-abc",
    messages: [
      { role: "system", content: "SECRET SYSTEM PROMPT" },
      { role: "user", content: "SECRET USER MESSAGE" },
    ],
  };
  const s = summarizeChatCompletionRequest(body, { suppliedSessionId: true });
  const json = JSON.stringify(s);
  assert(!json.includes("SECRET"));
  assertEquals(s.messageCount, 2);
  assertEquals(s.messageRoleSequence, ["system", "user"]);
  assertEquals(s.hasStream, true);
  assertEquals(s.hasUser, true);
  assertEquals(s.suppliedSessionId, true);
});

Deno.test("summarizeVapiEvent: masks customer number and captures shape", () => {
  const body = {
    message: {
      type: "end-of-call-report",
      timestamp: 12345,
      call: {
        id: "call_abc",
        customer: { number: "+14697472877" },
      },
    },
    phoneNumberId: "pn_xyz",
  };
  const s = summarizeVapiEvent(body);
  assertEquals(s.eventType, "end-of-call-report");
  assertEquals(s.customerNumberLast4, "***2877");
  assert(!JSON.stringify(s).includes("+14697472877"));
  assert(s.callIdPath !== null);
  assert(s.phoneNumberIdPath !== null);
  assert(s.providerTimestampPath !== null);
});

Deno.test("summarizeVapiEvent: tolerates missing metadata", () => {
  const s = summarizeVapiEvent({});
  assertEquals(s.eventType, null);
  assertEquals(s.callIdPath, null);
  assertEquals(s.customerNumberLast4, null);
});
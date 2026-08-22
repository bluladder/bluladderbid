import { buildKlamathVoiceRealtimeManifest } from "./voiceProviderKlamathConfig.ts";
import {
  buildKlamathVapiCreateAssistantRequest,
  type BuildKlamathVapiCreateAssistantRequestInput,
  KLAMATH_VAPI_CREATE_ASSISTANT_SCHEMA,
  serializeKlamathVapiCreateAssistantRequest,
  verifyKlamathVapiCreateAssistantRequest,
  verifyKlamathVapiSavedAssistant,
} from "./voiceProviderKlamathVapiSerializer.ts";

const serverEventsUrl = "https://provider-runtime.invalid/voice-vapi-events";
const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("values are not deeply equal");
  }
}

function assertThrows(action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error("expected action to throw");
}

function placeholderUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function reviewedTool(index: 0 | 1 | 2) {
  const tool = manifest.model.tools[index];
  return {
    toolId: placeholderUuid(index + 1),
    version: `v${index + 1}`,
    function: structuredClone(tool.function),
  };
}

function reviewedInput(): BuildKlamathVapiCreateAssistantRequestInput {
  return {
    serverEventsUrl,
    serverCredentialId: "runtime-only-server-credential",
    tools: [reviewedTool(0), reviewedTool(1), reviewedTool(2)],
  };
}

function cloneRequest(): Record<string, unknown> {
  return structuredClone(
    buildKlamathVapiCreateAssistantRequest(reviewedInput()),
  ) as Record<string, unknown>;
}

Deno.test("Klamath Vapi serializer uses the live CreateAssistantDTO array path", () => {
  const request = buildKlamathVapiCreateAssistantRequest(reviewedInput());
  assertEquals(KLAMATH_VAPI_CREATE_ASSISTANT_SCHEMA, {
    observedAt: "2026-08-21",
    operation: "POST /assistant",
    serverMessagesPath: "$.serverMessages",
    serverMessagesType: "array",
  });
  assertEquals(request.serverMessages, [
    "assistant.started",
    "status-update",
    "hang",
    "end-of-call-report",
    "tool-calls",
  ]);
  assert(Array.isArray(request.serverMessages));
  assert(!("monitorPlan" in request));
  assert(!("transcriber" in request));
  assert(!("phoneNumber" in request));
  assert(!("transferDestination" in request));
  assert(!("fallbackAssistantId" in request));
  assert(!("model" in request.voice));
});

Deno.test("Klamath Vapi serializer emits only exact version-pinned tools", () => {
  const request = buildKlamathVapiCreateAssistantRequest(reviewedInput());
  const model = request.model as Record<string, unknown>;
  assertEquals(model.toolRefs, [
    { toolId: placeholderUuid(1), version: "v1" },
    { toolId: placeholderUuid(2), version: "v2" },
    { toolId: placeholderUuid(3), version: "v3" },
  ]);
  assert(!("tools" in model));
  assert(!("toolIds" in model));
});

Deno.test("Klamath Vapi serializer survives an exact JSON round trip", () => {
  const input = reviewedInput();
  const serialized = serializeKlamathVapiCreateAssistantRequest(input);
  const parsed = JSON.parse(serialized);
  assertEquals(
    verifyKlamathVapiCreateAssistantRequest(parsed, input),
    [],
  );
  assertEquals(parsed.serverMessages.length, 5);
});

Deno.test("Klamath Vapi serializer rejects every known Explorer array failure", () => {
  const input = reviewedInput();
  const exactEvents = [
    "assistant.started",
    "status-update",
    "hang",
    "end-of-call-report",
    "tool-calls",
  ];
  const candidates: Array<Record<string, unknown>> = [];

  const scalar = cloneRequest();
  scalar.serverMessages = "tool-calls";
  candidates.push(scalar);

  const commaDelimited = cloneRequest();
  commaDelimited.serverMessages = exactEvents.join(",");
  candidates.push(commaDelimited);

  const overwritten = cloneRequest();
  overwritten.serverMessages = ["tool-calls"];
  candidates.push(overwritten);

  const empty = cloneRequest();
  empty.serverMessages = [];
  candidates.push(empty);

  const duplicate = cloneRequest();
  duplicate.serverMessages = [...exactEvents, "tool-calls"];
  candidates.push(duplicate);

  const reordered = cloneRequest();
  reordered.serverMessages = [...exactEvents].reverse();
  candidates.push(reordered);

  const missing = cloneRequest();
  missing.serverMessages = exactEvents.slice(0, -1);
  candidates.push(missing);

  const additional = cloneRequest();
  additional.serverMessages = [...exactEvents, "conversation-update"];
  candidates.push(additional);

  for (const candidate of candidates) {
    assert(
      verifyKlamathVapiCreateAssistantRequest(candidate, input).some((path) =>
        path.startsWith("$.serverMessages")
      ),
    );
  }
});

Deno.test("Klamath Vapi serializer rejects the historical nested representation", () => {
  const input = reviewedInput();
  const candidate = cloneRequest();
  const events = candidate.serverMessages;
  delete candidate.serverMessages;
  candidate.monitorPlan = { serverMessages: events };
  const paths = verifyKlamathVapiCreateAssistantRequest(candidate, input);
  assert(paths.includes("$.serverMessages"));
  assert(paths.some((path) => path.startsWith("$.monitorPlan")));
});

Deno.test("Klamath Vapi serializer rejects tool identity or schema drift", () => {
  const wrongOrder = reviewedInput();
  wrongOrder.tools = [
    wrongOrder.tools[1],
    wrongOrder.tools[0],
    wrongOrder.tools[2],
  ];
  assertThrows(() => buildKlamathVapiCreateAssistantRequest(wrongOrder));

  const changedSchema = reviewedInput();
  changedSchema.tools[0].function.parameters.required = ["caller"] as never;
  assertThrows(() => buildKlamathVapiCreateAssistantRequest(changedSchema));

  const duplicateIdentity = reviewedInput();
  duplicateIdentity.tools[1].toolId = duplicateIdentity.tools[0].toolId;
  assertThrows(() => buildKlamathVapiCreateAssistantRequest(duplicateIdentity));

  const unpublishedVersion = reviewedInput();
  unpublishedVersion.tools[2].version = "draft";
  assertThrows(() =>
    buildKlamathVapiCreateAssistantRequest(unpublishedVersion)
  );
});

Deno.test("Klamath Vapi serializer rejects provider-effective request drift", () => {
  const input = reviewedInput();
  const changedPrompt = cloneRequest();
  const model = changedPrompt.model as Record<string, unknown>;
  model.messages = [{ role: "system", content: "changed" }];
  assert(
    verifyKlamathVapiCreateAssistantRequest(changedPrompt, input).some((path) =>
      path.startsWith("$.model.messages")
    ),
  );

  const changedVoice = cloneRequest();
  (changedVoice.voice as Record<string, unknown>).voiceId = "other";
  assert(
    verifyKlamathVapiCreateAssistantRequest(changedVoice, input).includes(
      "$.voice.voiceId",
    ),
  );

  const extraAuthority = cloneRequest();
  extraAuthority.fallbackAssistantId = "unexpected";
  assert(
    verifyKlamathVapiCreateAssistantRequest(extraAuthority, input).includes(
      "$.fallbackAssistantId",
    ),
  );
});

Deno.test("Klamath Vapi saved-state verifier returns sanitized paths only", () => {
  const input = reviewedInput();
  const saved: Record<string, unknown> = {
    ...cloneRequest(),
    id: "provider-managed",
    orgId: "provider-managed",
    latestVersion: "v1",
  };
  assertEquals(verifyKlamathVapiSavedAssistant(saved, input), []);

  saved.transcriber = { provider: "unexpected" };
  (saved.voice as Record<string, unknown>).model = "unexpected";
  (saved.server as Record<string, unknown>).timeoutSeconds = 20;
  saved.monitorPlan = { serverMessages: ["tool-calls"] };
  saved.credentialIds = ["unexpected"];
  assertEquals(verifyKlamathVapiSavedAssistant(saved, input), [
    "$.credentialIds",
    "$.monitorPlan",
    "$.server.timeoutSeconds",
    "$.transcriber",
    "$.voice.model",
  ]);
});

Deno.test("Klamath manifest candidate source identity remains exact", async () => {
  const source = await Deno.readFile(
    new URL("./voiceProviderKlamathConfig.ts", import.meta.url),
  );
  const digest = await crypto.subtle.digest("SHA-256", source);
  const sha256 = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  assertEquals(source.byteLength, 9196);
  assertEquals(
    sha256,
    "cb53e67ccba87d01a6251f71b80c081f3ab296e4a3f6ea767112c14739bcdb90",
  );
});

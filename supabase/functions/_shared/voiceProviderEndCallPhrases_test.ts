import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoiceBetaAssistantManifest } from "./voiceProviderConfig.ts";
import {
  buildVapiAssistantPatch,
  fingerprintVapiAssistantAuthority,
  verifyVapiAssistantSnapshot,
} from "./voiceProviderReconciliation.ts";

const adapterUrl = "https://example.supabase.co/functions/v1/voice-llm-adapter";
const serverEventsUrl =
  "https://example.supabase.co/functions/v1/voice-vapi-events";
const manifest = buildVoiceBetaAssistantManifest({
  adapterUrl,
  serverEventsUrl,
});

function currentAssistant() {
  return {
    name: manifest.name,
    model: {
      provider: "custom-llm",
      url: adapterUrl,
      model: "bluladder-voice-adapter",
    },
    credentialIds: ["test-credential-id"],
    server: {
      url: serverEventsUrl,
      headers: { "X-Vapi-Secret": "test-secret-value" },
    },
  };
}

Deno.test("Vapi end-call phrases: manifest and bounded patch are explicitly empty", () => {
  assertEquals(manifest.endCallPhrases, []);
  const patch = buildVapiAssistantPatch(currentAssistant(), manifest);
  assertEquals(patch.endCallPhrases, []);
  assert(!("credentialIds" in patch));
  assert(!("server" in patch));
  assert(!("voice" in patch));
});

Deno.test("Vapi end-call phrases: empty or omitted saved state passes", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);
  assertEquals(
    await verifyVapiAssistantSnapshot(
      { ...current, ...patch },
      manifest,
      authority,
    ),
    [],
  );
  const omitted = { ...current, ...patch } as Record<string, unknown>;
  delete omitted.endCallPhrases;
  assertEquals(
    await verifyVapiAssistantSnapshot(omitted, manifest, authority),
    [],
  );
});

Deno.test("Vapi end-call phrases: legacy phrases and null fail closed", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);
  for (const endCallPhrases of [["thank you"], null]) {
    const issues = await verifyVapiAssistantSnapshot(
      { ...current, ...patch, endCallPhrases },
      manifest,
      authority,
    );
    assert(issues.some((issue) => issue.startsWith("endCallPhrases")));
  }
});

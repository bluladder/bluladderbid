import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoiceBetaAssistantManifest } from "./voiceProviderConfig.ts";
import {
  buildVapiAssistantPatch,
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
    id: "assistant-id",
    name: "BluLadder Voice Beta (isolated)",
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      smartFormat: true,
      keyterm: [...manifest.transcriber.keyterm],
      fallbackPlan: {
        transcribers: [{ provider: "assembly-ai", language: "en" }],
      },
    },
    model: {
      provider: "custom-llm",
      url: adapterUrl,
      model: "bluladder-voice-adapter",
    },
    voice: { provider: "vapi", voiceId: "Clara" },
    credentialIds: ["credential-id"],
    server: {
      url: serverEventsUrl,
      headers: { "X-Vapi-Secret": "present-but-never-logged" },
    },
  };
}

Deno.test("Vapi reconciliation: builds a bounded patch without credentials or voice", () => {
  const patch = buildVapiAssistantPatch(currentAssistant(), manifest);
  assertEquals(patch.name, "BluLadder Voice Beta (isolated)");
  assertEquals(patch.model.tools, []);
  assertEquals(patch.transcriber, manifest.transcriber);
  assertEquals(patch.serverMessages, [...manifest.serverEvents.events]);
  assertEquals(patch.artifactPlan, manifest.artifactPlan);
  assertEquals(patch.hooks.length, 2);
  assert(!("credentialIds" in patch));
  assert(!("server" in patch));
  assert(!("voice" in patch));
  assert(!JSON.stringify(patch).includes("present-but-never-logged"));
});

Deno.test("Vapi reconciliation: rejects missing credential or server authority", () => {
  const noCredentials = currentAssistant();
  noCredentials.credentialIds = [];
  assertThrows(() => buildVapiAssistantPatch(noCredentials, manifest));

  const wrongServer = currentAssistant();
  wrongServer.server.url = "https://other.example.com/events";
  assertThrows(() => buildVapiAssistantPatch(wrongServer, manifest));
});

Deno.test("Vapi reconciliation: reported saved state fails exact verification", () => {
  const saved = currentAssistant() as Record<string, unknown>;
  saved.serverMessages = ["status-update", "hang", "end-of-call-report"];
  saved.artifactPlan = {
    recordingEnabled: false,
    videoRecordingEnabled: false,
    pcapEnabled: false,
    transcriptPlan: { enabled: true },
  };
  const issues = verifyVapiAssistantSnapshot(saved, manifest);
  assert(issues.some((issue) => issue.startsWith("serverMessages")));
  assert(issues.some((issue) => issue.startsWith("artifactPlan")));
  assert(
    issues.some((issue) =>
      issue.startsWith("transcriber.fallbackPlan.transcribers")
    ),
  );
});

Deno.test("Vapi reconciliation: exact saved state passes with false canonicalized away", () => {
  const current = currentAssistant();
  const patch = buildVapiAssistantPatch(current, manifest);
  const saved = {
    ...current,
    ...patch,
    transcriber: structuredClone(patch.transcriber),
  };
  const fallbackPlan = saved.transcriber.fallbackPlan as Record<
    string,
    unknown
  >;
  delete fallbackPlan.autoFallback;
  assertEquals(verifyVapiAssistantSnapshot(saved, manifest), []);
});

Deno.test("Vapi reconciliation: enabled automatic fallback always fails", () => {
  const current = currentAssistant();
  const patch = buildVapiAssistantPatch(current, manifest);
  const saved = { ...current, ...patch };
  (saved.transcriber.fallbackPlan as Record<string, unknown>).autoFallback = {
    enabled: true,
  };
  const issues = verifyVapiAssistantSnapshot(saved, manifest);
  assert(issues.some((issue) => issue.includes("autoFallback")));
});

import {
  assert,
  assertEquals,
  assertThrows,
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
  assertEquals(patch.model.timeoutSeconds, 20);
  assertEquals(patch.stopSpeakingPlan, {
    numWords: 2,
    voiceSeconds: 0.4,
    backoffSeconds: 1,
  });
  assertEquals(patch.transcriber, manifest.transcriber);
  assertEquals(patch.serverMessages, [...manifest.serverEvents.events]);
  assertEquals(patch.artifactPlan, manifest.artifactPlan);
  assertEquals(patch.hooks.length, 2);
  assert(!("credentialIds" in patch));
  assert(!("server" in patch));
  assert(!("voice" in patch));
  assert(!JSON.stringify(patch).includes("present-but-never-logged"));
});

Deno.test("Vapi reconciliation: interruption and timeout drift fail closed", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);
  const interruptionIssues = await verifyVapiAssistantSnapshot(
    {
      ...current,
      ...patch,
      stopSpeakingPlan: {
        numWords: 0,
        voiceSeconds: 0.2,
        backoffSeconds: 1,
      },
    },
    manifest,
    authority,
  );
  assert(
    interruptionIssues.some((issue) => issue.startsWith("stopSpeakingPlan")),
  );
  const timeoutIssues = await verifyVapiAssistantSnapshot(
    {
      ...current,
      ...patch,
      model: { ...patch.model, timeoutSeconds: null },
    },
    manifest,
    authority,
  );
  assert(
    timeoutIssues.some((issue) => issue.startsWith("model.timeoutSeconds")),
  );
});

Deno.test("Vapi reconciliation: rejects missing credential or server authority", () => {
  const noCredentials = currentAssistant();
  noCredentials.credentialIds = [];
  assertThrows(() => buildVapiAssistantPatch(noCredentials, manifest));

  const wrongServer = currentAssistant();
  wrongServer.server.url = "https://other.example.com/events";
  assertThrows(() => buildVapiAssistantPatch(wrongServer, manifest));
});

Deno.test("Vapi reconciliation: reported saved state fails exact verification", async () => {
  const saved = currentAssistant() as Record<string, unknown>;
  const authority = await fingerprintVapiAssistantAuthority(saved, manifest);
  saved.serverMessages = ["status-update", "hang", "end-of-call-report"];
  saved.artifactPlan = {
    recordingEnabled: false,
    videoRecordingEnabled: false,
    pcapEnabled: false,
    transcriptPlan: { enabled: true },
  };
  const issues = await verifyVapiAssistantSnapshot(saved, manifest, authority);
  assert(issues.some((issue) => issue.startsWith("serverMessages")));
  assert(issues.some((issue) => issue.startsWith("artifactPlan")));
  assert(
    issues.some((issue) =>
      issue.startsWith("transcriber.fallbackPlan.transcribers")
    ),
  );
});

Deno.test("Vapi reconciliation: exact saved state passes with false canonicalized away", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
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
  assertEquals(
    await verifyVapiAssistantSnapshot(saved, manifest, authority),
    [],
  );
});

Deno.test("Vapi reconciliation: enabled automatic fallback always fails", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);
  const saved = { ...current, ...patch };
  (saved.transcriber.fallbackPlan as Record<string, unknown>).autoFallback = {
    enabled: true,
  };
  const issues = await verifyVapiAssistantSnapshot(saved, manifest, authority);
  assert(issues.some((issue) => issue.includes("autoFallback")));
});

Deno.test("Vapi reconciliation: provider object key order is not semantic drift", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);
  const saved = {
    ...current,
    ...patch,
    transcriber: {
      ...patch.transcriber,
      fallbackPlan: {
        transcribers: [{
          vadAssistedEndpointingEnabled: true,
          keytermsPrompt: [...manifest.transcriber.keyterm],
          language: "en",
          speechModel: "universal-streaming-english",
          provider: "assembly-ai",
        }],
      },
    },
    hooks: patch.hooks.map((hook) => {
      const action = (hook.do as Record<string, unknown>[])[0];
      const options = hook.options as Record<string, unknown>;
      return {
        do: [{ exact: action.exact, type: action.type }],
        options: { seconds: options.seconds },
        on: hook.on,
      };
    }),
    artifactPlan: {
      transcriptPlan: { enabled: false },
      fullMessageHistoryEnabled: false,
      loggingEnabled: false,
      pcapEnabled: false,
      videoRecordingEnabled: false,
      recordingEnabled: false,
    },
    startSpeakingPlan: {
      transcriptionEndpointingPlan: {
        onNumberSeconds: 1,
        onNoPunctuationSeconds: 1.2,
        onPunctuationSeconds: 0.3,
      },
      smartEndpointingPlan: {
        waitFunction: manifest.startSpeakingPlan.smartEndpointingPlan
          .waitFunction,
        provider: "livekit",
      },
      waitSeconds: 0.4,
    },
  };

  assertEquals(
    await verifyVapiAssistantSnapshot(saved, manifest, authority),
    [],
  );
});

Deno.test("Vapi reconciliation: arrays and extra object fields remain exact", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);

  const reorderedArray = {
    ...current,
    ...patch,
    serverMessages: [...patch.serverMessages].reverse(),
  };
  const arrayIssues = await verifyVapiAssistantSnapshot(
    reorderedArray,
    manifest,
    authority,
  );
  assert(arrayIssues.some((issue) => issue.startsWith("serverMessages")));

  const extraObjectField = {
    ...current,
    ...patch,
    artifactPlan: { ...patch.artifactPlan, providerAdded: true },
  };
  const objectIssues = await verifyVapiAssistantSnapshot(
    extraObjectField,
    manifest,
    authority,
  );
  assert(objectIssues.some((issue) => issue.startsWith("artifactPlan")));
});

Deno.test("Vapi reconciliation: changed credential authority fails closed", async () => {
  const current = currentAssistant();
  const authority = await fingerprintVapiAssistantAuthority(current, manifest);
  const patch = buildVapiAssistantPatch(current, manifest);

  const changedCredential = {
    ...current,
    ...patch,
    credentialIds: ["different-credential-id"],
  };
  const credentialIssues = await verifyVapiAssistantSnapshot(
    changedCredential,
    manifest,
    authority,
  );
  assert(
    credentialIssues.some((issue) => issue.includes("credential identity")),
  );

  const changedServerSecret = {
    ...current,
    ...patch,
    server: {
      ...current.server,
      headers: { "X-Vapi-Secret": "different-secret" },
    },
  };
  const serverIssues = await verifyVapiAssistantSnapshot(
    changedServerSecret,
    manifest,
    authority,
  );
  assert(
    serverIssues.some((issue) => issue.includes("server credential")),
  );

  const malformedAuthorityIssues = await verifyVapiAssistantSnapshot(
    { ...current, ...patch },
    manifest,
    {} as never,
  );
  assert(
    malformedAuthorityIssues.some((issue) =>
      issue.includes("fingerprint is missing or malformed")
    ),
  );
});

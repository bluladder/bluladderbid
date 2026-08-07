import type { VoiceBetaManifest } from "./voiceProviderConfig.ts";

type JsonRecord = Record<string, unknown>;

export interface VapiAssistantPatch extends JsonRecord {
  name: string;
  transcriber: JsonRecord;
  model: JsonRecord;
  serverMessages: string[];
  maxDurationSeconds: number;
  endCallMessage: string;
  endCallPhrases: string[];
  hooks: JsonRecord[];
  artifactPlan: JsonRecord;
  analysisPlan: JsonRecord;
  startSpeakingPlan: JsonRecord;
  stopSpeakingPlan: JsonRecord;
}

/**
 * Non-secret identity proof for the credentials attached to an assistant.
 * Capture this from an approved baseline and keep it in operator-controlled
 * release evidence; never persist or print the raw credential values.
 */
export interface VapiAssistantAuthorityFingerprint {
  credentialIdsSha256: string;
  serverSecretSha256: string;
}

/**
 * Builds the smallest complete Vapi PATCH needed to reconcile reviewed voice
 * behavior. Credential IDs, server headers, voice selection, and other
 * unrelated live fields are deliberately not sent. The current model object
 * is preserved while its tool list is made explicitly empty.
 */
export function buildVapiAssistantPatch(
  current: unknown,
  manifest: VoiceBetaManifest,
): VapiAssistantPatch {
  const assistant = requireRecord(current, "assistant");
  const model = requireRecord(assistant.model, "assistant.model");

  if (model.provider !== manifest.model.provider) {
    throw new Error("assistant.model.provider does not match the manifest");
  }
  if (model.url !== manifest.model.url) {
    throw new Error("assistant.model.url does not match the manifest");
  }
  if (typeof model.model !== "string" || model.model.length === 0) {
    throw new Error("assistant.model.model is missing");
  }

  requireCredentialPresence(assistant);
  requireServerAuthority(assistant, manifest.serverEvents.url);

  return {
    name: manifest.name,
    transcriber: structuredClone(manifest.transcriber) as unknown as JsonRecord,
    model: {
      ...model,
      timeoutSeconds: manifest.model.timeoutSeconds,
      tools: [],
    },
    serverMessages: [...manifest.serverEvents.events],
    maxDurationSeconds: manifest.duration.maxDurationSeconds,
    endCallMessage: manifest.duration.hardCutoffMessage,
    endCallPhrases: [...manifest.endCallPhrases],
    hooks: manifest.duration.timeElapsedHooks.map((hook) => ({
      on: "call.timeElapsed",
      options: { seconds: hook.seconds },
      do: [{ type: "say", exact: hook.say }],
    })),
    artifactPlan: structuredClone(
      manifest.artifactPlan,
    ) as unknown as JsonRecord,
    analysisPlan: structuredClone(
      manifest.analysisPlan,
    ) as unknown as JsonRecord,
    startSpeakingPlan: structuredClone(
      manifest.startSpeakingPlan,
    ) as unknown as JsonRecord,
    stopSpeakingPlan: structuredClone(
      manifest.stopSpeakingPlan,
    ) as unknown as JsonRecord,
  };
}

/**
 * Verifies the raw Vapi REST response after PATCH. This must receive the raw
 * API object, not the v0.2.1 CLI's reduced typed projection.
 *
 * Vapi documents automatic transcriber fallback as opt-in. Its API may
 * canonicalize `{ enabled: false }` by omitting `autoFallback`; either an
 * omitted object or an explicit false is therefore fail-closed. Explicit true
 * always fails.
 */
export async function verifyVapiAssistantSnapshot(
  snapshot: unknown,
  manifest: VoiceBetaManifest,
  expectedAuthority: VapiAssistantAuthorityFingerprint,
): Promise<string[]> {
  const issues: string[] = [];
  const assistant = asRecord(snapshot);
  if (!assistant) return ["assistant response is not an object"];

  expectEqual(issues, "name", assistant.name, manifest.name);

  const transcriber = child(issues, assistant, "transcriber");
  if (transcriber) {
    expectEqual(
      issues,
      "transcriber.provider",
      transcriber.provider,
      "deepgram",
    );
    expectEqual(issues, "transcriber.model", transcriber.model, "nova-3");
    expectEqual(issues, "transcriber.language", transcriber.language, "en");
    expectEqual(
      issues,
      "transcriber.smartFormat",
      transcriber.smartFormat,
      true,
    );
    expectJson(
      issues,
      "transcriber.keyterm",
      transcriber.keyterm,
      manifest.transcriber.keyterm,
    );

    const fallbackPlan = child(issues, transcriber, "fallbackPlan");
    if (fallbackPlan) {
      const automatic = fallbackPlan.autoFallback;
      if (automatic !== undefined) {
        const autoRecord = asRecord(automatic);
        if (!autoRecord || autoRecord.enabled !== false) {
          issues.push(
            "transcriber.fallbackPlan.autoFallback must be absent or explicitly disabled",
          );
        }
      }
      expectJson(
        issues,
        "transcriber.fallbackPlan.transcribers",
        fallbackPlan.transcribers,
        manifest.transcriber.fallbackPlan.transcribers,
      );
    }
  }

  const model = child(issues, assistant, "model");
  if (model) {
    expectEqual(
      issues,
      "model.provider",
      model.provider,
      manifest.model.provider,
    );
    expectEqual(issues, "model.url", model.url, manifest.model.url);
    if (typeof model.model !== "string" || model.model.length === 0) {
      issues.push("model.model is missing");
    }
    expectEqual(
      issues,
      "model.timeoutSeconds",
      model.timeoutSeconds,
      manifest.model.timeoutSeconds,
    );
    expectJson(issues, "model.tools", model.tools, []);
  }

  expectJson(
    issues,
    "serverMessages",
    assistant.serverMessages,
    manifest.serverEvents.events,
  );
  expectEqual(
    issues,
    "maxDurationSeconds",
    assistant.maxDurationSeconds,
    manifest.duration.maxDurationSeconds,
  );
  expectEqual(
    issues,
    "endCallMessage",
    assistant.endCallMessage,
    manifest.duration.hardCutoffMessage,
  );
  // Vapi may canonicalize an empty list by omitting the field. Any present
  // value must be exactly empty; null or a legacy phrase fails closed.
  if (assistant.endCallPhrases !== undefined) {
    expectJson(issues, "endCallPhrases", assistant.endCallPhrases, []);
  }
  expectJson(
    issues,
    "hooks",
    assistant.hooks,
    manifest.duration.timeElapsedHooks.map((hook) => ({
      on: "call.timeElapsed",
      options: { seconds: hook.seconds },
      do: [{ type: "say", exact: hook.say }],
    })),
  );
  expectJson(
    issues,
    "artifactPlan",
    assistant.artifactPlan,
    manifest.artifactPlan,
  );
  expectJson(
    issues,
    "analysisPlan",
    assistant.analysisPlan,
    manifest.analysisPlan,
  );
  expectJson(
    issues,
    "startSpeakingPlan",
    assistant.startSpeakingPlan,
    manifest.startSpeakingPlan,
  );
  expectJson(
    issues,
    "stopSpeakingPlan",
    assistant.stopSpeakingPlan,
    manifest.stopSpeakingPlan,
  );

  await verifyAuthorityFingerprint(
    issues,
    assistant,
    manifest.serverEvents.url,
    expectedAuthority,
  );

  return issues;
}

/**
 * Creates a non-secret fingerprint from a separately approved assistant
 * snapshot. The caller must treat the input as sensitive and must not log it.
 */
export async function fingerprintVapiAssistantAuthority(
  snapshot: unknown,
  manifest: VoiceBetaManifest,
): Promise<VapiAssistantAuthorityFingerprint> {
  const assistant = requireRecord(snapshot, "assistant");
  const credentialIds = requireCredentialIds(assistant);
  const serverSecret = requireServerSecret(
    assistant,
    manifest.serverEvents.url,
  );
  return {
    credentialIdsSha256: await sha256(
      JSON.stringify([...credentialIds].sort()),
    ),
    serverSecretSha256: await sha256(serverSecret),
  };
}

function requireCredentialPresence(assistant: JsonRecord): void {
  requireCredentialIds(assistant);
}

function requireCredentialIds(assistant: JsonRecord): string[] {
  if (
    !Array.isArray(assistant.credentialIds) ||
    assistant.credentialIds.length === 0 ||
    assistant.credentialIds.some((value) =>
      typeof value !== "string" || value.length === 0
    )
  ) {
    throw new Error(
      "assistant.credentialIds must contain saved credential IDs",
    );
  }
  return assistant.credentialIds as string[];
}

function requireServerAuthority(
  assistant: JsonRecord,
  expectedUrl: string,
): void {
  requireServerSecret(assistant, expectedUrl);
}

function requireServerSecret(
  assistant: JsonRecord,
  expectedUrl: string,
): string {
  const server = requireRecord(assistant.server, "assistant.server");
  if (server.url !== expectedUrl) {
    throw new Error("assistant.server.url does not match the manifest");
  }
  const headers = requireRecord(server.headers, "assistant.server.headers");
  if (
    typeof headers["X-Vapi-Secret"] !== "string" ||
    (headers["X-Vapi-Secret"] as string).length === 0
  ) {
    throw new Error("assistant.server.headers lacks X-Vapi-Secret presence");
  }
  return headers["X-Vapi-Secret"] as string;
}

async function verifyAuthorityFingerprint(
  issues: string[],
  assistant: JsonRecord,
  expectedUrl: string,
  expected: VapiAssistantAuthorityFingerprint,
): Promise<void> {
  const expectedRecord = asRecord(expected);
  if (!isSha256(expectedRecord?.credentialIdsSha256)) {
    issues.push("expected credential ID fingerprint is missing or malformed");
  }
  if (!isSha256(expectedRecord?.serverSecretSha256)) {
    issues.push("expected server secret fingerprint is missing or malformed");
  }
  if (issues.some((issue) => issue.startsWith("expected "))) return;

  const expectedCredentialIdsSha256 = expectedRecord
    ?.credentialIdsSha256 as string;
  const expectedServerSecretSha256 = expectedRecord
    ?.serverSecretSha256 as string;

  try {
    const credentialIds = requireCredentialIds(assistant);
    const actual = await sha256(JSON.stringify([...credentialIds].sort()));
    if (actual !== expectedCredentialIdsSha256) {
      issues.push("assistant credential identity does not match approval");
    }
  } catch (error) {
    issues.push((error as Error).message);
  }

  try {
    const serverSecret = requireServerSecret(assistant, expectedUrl);
    const actual = await sha256(serverSecret);
    if (actual !== expectedServerSecretSha256) {
      issues.push("assistant server credential does not match approval");
    }
  } catch (error) {
    issues.push((error as Error).message);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function requireRecord(value: unknown, path: string): JsonRecord {
  const result = asRecord(value);
  if (!result) throw new Error(`${path} is missing or not an object`);
  return result;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function child(
  issues: string[],
  parent: JsonRecord,
  key: string,
): JsonRecord | null {
  const value = asRecord(parent[key]);
  if (!value) issues.push(`${key} is missing or not an object`);
  return value;
}

function expectEqual(
  issues: string[],
  path: string,
  actual: unknown,
  expected: unknown,
): void {
  if (actual !== expected) issues.push(`${path} does not match the manifest`);
}

function expectJson(
  issues: string[],
  path: string,
  actual: unknown,
  expected: unknown,
): void {
  if (!jsonSemanticallyEqual(actual, expected)) {
    issues.push(`${path} does not match the manifest`);
  }
}

/** JSON object key order is not semantic; array order and object shape are. */
function jsonSemanticallyEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;

  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) =>
        jsonSemanticallyEqual(value, expected[index])
      );
  }

  const actualRecord = asRecord(actual);
  const expectedRecord = asRecord(expected);
  if (!actualRecord || !expectedRecord) return false;

  const actualKeys = Object.keys(actualRecord).sort();
  const expectedKeys = Object.keys(expectedRecord).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) =>
      key === expectedKeys[index] &&
      jsonSemanticallyEqual(actualRecord[key], expectedRecord[key])
    );
}

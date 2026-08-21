import type { VoiceRealtimeFunctionTool } from "./voiceProviderConfig.ts";
import {
  buildKlamathVoiceRealtimeManifest,
  type BuildKlamathVoiceRealtimeManifestInput,
} from "./voiceProviderKlamathConfig.ts";

type JsonRecord = Record<string, unknown>;

/**
 * Observed in Vapi's live OpenAPI document at https://api.vapi.ai/api-json on
 * 2026-08-21. CreateAssistantDTO.serverMessages is a top-level array;
 * MonitorPlan does not contain serverMessages.
 */
export const KLAMATH_VAPI_CREATE_ASSISTANT_SCHEMA = {
  observedAt: "2026-08-21",
  operation: "POST /assistant",
  serverMessagesPath: "$.serverMessages",
  serverMessagesType: "array",
} as const;

export interface KlamathVapiReviewedToolBinding {
  /** Resolved in memory during the separately approved provider action. */
  toolId: string;
  /** Exact published tool version selected during the provider preflight. */
  version: string;
  function: VoiceRealtimeFunctionTool["function"];
}

export interface BuildKlamathVapiCreateAssistantRequestInput
  extends BuildKlamathVoiceRealtimeManifestInput {
  /** Resolved in memory; never persist or log this provider identifier. */
  serverCredentialId: string;
  /** Exact reviewed tools in manifest order. */
  tools: readonly [
    KlamathVapiReviewedToolBinding,
    KlamathVapiReviewedToolBinding,
    KlamathVapiReviewedToolBinding,
  ];
}

export interface KlamathVapiCreateAssistantRequest extends JsonRecord {
  name: string;
  firstMessage: string;
  firstMessageMode: "assistant-speaks-first";
  firstMessageInterruptionsEnabled: true;
  model: JsonRecord;
  voice: JsonRecord;
  startSpeakingPlan: JsonRecord;
  stopSpeakingPlan: JsonRecord;
  backgroundSound: "off";
  modelOutputInMessagesEnabled: false;
  endCallPhrases: [];
  maxDurationSeconds: number;
  endCallMessage: string;
  hooks: JsonRecord[];
  artifactPlan: JsonRecord;
  analysisPlan: JsonRecord;
  serverMessages: string[];
  server: JsonRecord;
}

/**
 * Converts the digest-approved provider-neutral Klamath manifest into the
 * current raw Vapi Create Assistant shape. Runtime authority is accepted only
 * as function input and is never returned by validation errors.
 */
export function buildKlamathVapiCreateAssistantRequest(
  input: BuildKlamathVapiCreateAssistantRequestInput,
): KlamathVapiCreateAssistantRequest {
  const manifest = buildKlamathVoiceRealtimeManifest({
    serverEventsUrl: input.serverEventsUrl,
  });

  requireProviderIdentifier(input.serverCredentialId, "serverCredentialId");
  const toolRefs = validateAndMapTools(input.tools, manifest.model.tools);

  return {
    name: manifest.name,
    firstMessage: manifest.firstMessage,
    firstMessageMode: manifest.firstMessageMode,
    firstMessageInterruptionsEnabled: manifest.firstMessageInterruptionsEnabled,
    model: {
      provider: manifest.model.provider,
      model: manifest.model.model,
      messages: structuredClone(manifest.model.messages),
      temperature: manifest.model.temperature,
      maxTokens: manifest.model.maxTokens,
      toolRefs,
    },
    voice: structuredClone(manifest.voice) as JsonRecord,
    startSpeakingPlan: structuredClone(
      manifest.startSpeakingPlan,
    ) as JsonRecord,
    stopSpeakingPlan: structuredClone(
      manifest.stopSpeakingPlan,
    ) as JsonRecord,
    backgroundSound: manifest.backgroundSound,
    modelOutputInMessagesEnabled: manifest.modelOutputInMessagesEnabled,
    endCallPhrases: [],
    maxDurationSeconds: manifest.duration.maxDurationSeconds,
    endCallMessage: manifest.duration.hardCutoffMessage,
    hooks: manifest.duration.timeElapsedHooks.map((hook) => ({
      on: "call.timeElapsed",
      options: { seconds: hook.seconds },
      do: [{ type: "say", exact: hook.say }],
    })),
    artifactPlan: structuredClone(manifest.artifactPlan) as JsonRecord,
    analysisPlan: structuredClone(manifest.analysisPlan) as JsonRecord,
    serverMessages: [...manifest.serverEvents.events],
    server: {
      url: manifest.serverEvents.url,
      credentialId: input.serverCredentialId,
    },
  };
}

/**
 * Produces the exact raw request body only after a JSON round trip proves that
 * the approved array and every other serialized field survived unchanged.
 */
export function serializeKlamathVapiCreateAssistantRequest(
  input: BuildKlamathVapiCreateAssistantRequestInput,
): string {
  const expected = buildKlamathVapiCreateAssistantRequest(input);
  const serialized = JSON.stringify(expected);
  const parsed = JSON.parse(serialized) as unknown;
  const driftPaths = verifyKlamathVapiCreateAssistantRequest(parsed, input);
  if (driftPaths.length > 0) {
    throw new Error(
      `Klamath Vapi request failed serialization verification: ${
        driftPaths.join(
          ",",
        )
      }`,
    );
  }
  return serialized;
}

/** Returns sanitized JSON paths only; it never returns provider values. */
export function verifyKlamathVapiCreateAssistantRequest(
  candidate: unknown,
  input: BuildKlamathVapiCreateAssistantRequestInput,
): string[] {
  const expected = buildKlamathVapiCreateAssistantRequest(input);
  const paths = diffJsonPaths(expected, candidate);
  return [...new Set(paths)].sort();
}

/**
 * Checks the provider-effective saved fields returned by raw GET /assistant.
 * Provider-managed identity, timestamps, and version markers are ignored.
 * Any returned issue is a sanitized JSON path suitable for the receipt.
 */
export function verifyKlamathVapiSavedAssistant(
  snapshot: unknown,
  input: BuildKlamathVapiCreateAssistantRequestInput,
): string[] {
  const expected = buildKlamathVapiCreateAssistantRequest(input);
  const saved = asRecord(snapshot);
  if (!saved) return ["$"];

  const paths: string[] = [];
  for (const key of Object.keys(expected)) {
    paths.push(
      ...diffJsonPaths(
        expected[key],
        saved[key],
        `$.${key}`,
      ),
    );
  }

  for (
    const forbiddenPath of [
      "$.transcriber",
      "$.voice.model",
      "$.model.tools",
      "$.model.toolIds",
      "$.credentialIds",
      "$.credentials",
      "$.clientMessages",
      "$.monitorPlan",
      "$.server.timeoutSeconds",
      "$.server.headers",
      "$.fallbackAssistantId",
      "$.fallbackDestination",
      "$.transferDestination",
      "$.phoneNumberId",
      "$.squadId",
      "$.workflowId",
      "$.messages",
      "$.variableExtractionPlan",
      "$.observabilityPlan",
      "$.transportConfigurations",
    ]
  ) {
    if (hasJsonPath(saved, forbiddenPath)) paths.push(forbiddenPath);
  }

  return [...new Set(paths)].sort();
}

function validateAndMapTools(
  bindings: readonly KlamathVapiReviewedToolBinding[],
  expectedTools: readonly VoiceRealtimeFunctionTool[],
): Array<{ toolId: string; version: string }> {
  if (bindings.length !== 3) {
    throw new Error("exactly three reviewed tool bindings are required");
  }

  const ids = new Set<string>();
  return bindings.map((binding, index) => {
    if (!isUuid(binding.toolId)) {
      throw new Error(`tools[${index}].toolId must be a UUID`);
    }
    if (ids.has(binding.toolId)) {
      throw new Error("reviewed tool bindings must be unique");
    }
    ids.add(binding.toolId);
    if (!/^v[1-9][0-9]*$/.test(binding.version)) {
      throw new Error(`tools[${index}].version must be a published version`);
    }

    const expected = expectedTools[index]?.function;
    if (!expected || !sameJson(binding.function, expected)) {
      throw new Error(
        `tools[${index}] does not match the approved ${
          expected?.name ?? "tool"
        } definition`,
      );
    }
    return { toolId: binding.toolId, version: binding.version };
  });
}

function requireProviderIdentifier(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be supplied at runtime`);
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffJsonPaths(
  expected: unknown,
  actual: unknown,
  path = "$",
): string[] {
  if (sameJson(expected, actual)) return [];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [path];
    const paths: string[] = [];
    if (expected.length !== actual.length) paths.push(path);
    for (
      let index = 0;
      index < Math.max(expected.length, actual.length);
      index++
    ) {
      paths.push(
        ...diffJsonPaths(expected[index], actual[index], `${path}[${index}]`),
      );
    }
    return paths;
  }

  const expectedRecord = asRecord(expected);
  const actualRecord = asRecord(actual);
  if (expectedRecord) {
    if (!actualRecord) return [path];
    const paths: string[] = [];
    const keys = new Set([
      ...Object.keys(expectedRecord),
      ...Object.keys(actualRecord),
    ]);
    for (const key of keys) {
      paths.push(
        ...diffJsonPaths(
          expectedRecord[key],
          actualRecord[key],
          `${path}.${key}`,
        ),
      );
    }
    return paths;
  }

  return [path];
}

function hasJsonPath(root: JsonRecord, path: string): boolean {
  const parts = path.slice(2).split(".");
  let current: unknown = root;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record || !(part in record)) return false;
    current = record[part];
  }
  return true;
}

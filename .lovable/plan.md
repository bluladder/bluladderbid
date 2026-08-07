# Voice SSE Deferred Streaming + endCallPhrases Fail-Closed Removal (plan only)

Base: `main` @ `cc069ff5670937e2a59a1cd2251ae55b16b045f9`. No edits, deploys, secret or provider mutations in this turn.

## Diagnosis this patch addresses

`voice-llm-adapter` builds its controller SSE body only after `executeControllerRoute` + `completeVoiceTurn` + `isAuthoritativeVoiceTurn` all resolve (`supabase/functions/voice-llm-adapter/index.ts:649`, stream constructed at `:138-225`). With 4.697-7.745 s of pre-stream work, Vapi receives no bytes for seconds and then one large content chunk; two valid responses produced no TTS. Separately, saved Vapi retains broad legacy `endCallPhrases`, and the approved manifest (`supabase/functions/_shared/voiceProviderConfig.ts`) has no `endCallPhrases` field, so reconciliation cannot remove them.

## Exact recommended file list

New:
1. `supabase/functions/_shared/voice/voiceControllerStream.ts` — deferred OpenAI-compatible SSE writer (role first, bounded one-time neutral `<flush />` ack, ordered content chunks, safe close).
2. `supabase/functions/_shared/voice/voiceControllerStream_test.ts` — deterministic Deno tests.
3. `supabase/functions/_shared/voiceProviderEndCallPhrases_test.ts` — manifest/patch/verify/drift tests for `endCallPhrases: []`.

Modified:
4. `supabase/functions/voice-llm-adapter/index.ts` — controller branch returns the stream immediately after authority + claim + conversation setup; controller work and authority recheck run inside the stream; non-streaming path untouched.
5. `supabase/functions/_shared/voiceProviderConfig.ts` — add `endCallPhrases: []` to `VoiceBetaManifest` and the builder.
6. `supabase/functions/_shared/voiceProviderReconciliation.ts` — include `endCallPhrases` in the bounded PATCH and verify it fail-closed.
7. `scripts/check-voice-artifact-retention-contract.mjs` — exact-path fragment additions (item 10).
8. `docs/voice-beta-vapi-provisioning.md` — one runbook subsection for `endCallPhrases = empty` and the SSE contract.

No other files. No wildcard globs anywhere.

## 1. New: `supabase/functions/_shared/voice/voiceControllerStream.ts` (complete content)

```ts
// ============================================================================
// Deferred OpenAI-compatible SSE writer for one authoritative controller turn.
//
// Contract (Vapi custom-LLM):
//  - The Response is returned before controller work starts; the assistant
//    role delta is the first frame so the provider sees a live response.
//  - No business content is emitted before the controller result exists.
//  - If work is still pending after `ackDelayMs`, exactly one short neutral
//    acknowledgement is emitted, suffixed with " <flush />" so Vapi speaks it
//    immediately. It never claims success, price, booking, delivery, identity,
//    or address, and it is never emitted for fast completions.
//  - Canonical spoken text is emitted in small ordered chunks, then one stop
//    chunk carrying the bluladder metadata, then [DONE].
//  - Suppressed outcomes (error, stale authority, duplicate) emit no business
//    content and close cleanly.
// ============================================================================

export const VOICE_STREAM_ACK_DELAY_MS = 1_200;
/** Neutral, non-committal, no business claim of any kind. */
export const VOICE_STREAM_ACKNOWLEDGEMENT = "One moment.";
export const VOICE_STREAM_FLUSH_TAG = " <flush />";
export const VOICE_STREAM_CHUNK_CHARS = 120;

export type ControllerStreamResult =
  | {
    status: "speak";
    spoken: string;
    metadata?: {
      action?: { kind: string; reasonCode?: string };
      event?: string;
      route?: string;
      state?: string;
    };
  }
  | { status: "suppressed" };

export interface ControllerStreamLifecycle {
  onFirstChunk?: () => void;
  onAcknowledgement?: () => void;
  onComplete?: (status: "speak" | "suppressed" | "aborted") => void;
}

export interface ControllerStreamOptions {
  model: string;
  buildId: string;
  /** Invoked exactly once, inside the stream. */
  run: () => Promise<ControllerStreamResult>;
  ackDelayMs?: number;
  chunkChars?: number;
  lifecycle?: ControllerStreamLifecycle;
  /** Test seam only. */
  sleep?: (ms: number) => Promise<void>;
}

/** Splits on word boundaries; never splits mid-word. */
export function splitSpokenChunks(
  spoken: string,
  maxChars = VOICE_STREAM_CHUNK_CHARS,
): string[] {
  const text = spoken.trim();
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildControllerStreamBody(
  options: ControllerStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const ackDelayMs = options.ackDelayMs ?? VOICE_STREAM_ACK_DELAY_MS;
  const sleep = options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let closed = false;
  let firstChunkSeen = false;
  let started = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (started) return; // run() must execute exactly once
      started = true;

      const write = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          );
        } catch {
          closed = true; // transport gone; never rethrow into the turn
          return false;
        }
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          try {
            options.lifecycle?.onFirstChunk?.();
          } catch { /* telemetry never changes streaming */ }
        }
        return true;
      };
      const frame = (delta: unknown, finish: string | null, extra = {}) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model: options.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...extra,
      });
      const done = (status: "speak" | "suppressed" | "aborted") => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch { /* transport gone */ }
        }
        closed = true;
        try {
          controller.close();
        } catch { /* already closed */ }
        try {
          options.lifecycle?.onComplete?.(status);
        } catch { /* telemetry never changes streaming */ }
      };

      // 1. Immediate role delta — establishes the response and first byte.
      write(frame({ role: "assistant" }, null));

      // 2. Bounded one-time neutral acknowledgement while work is pending.
      let settled = false;
      const work = options.run().then(
        (result) => {
          settled = true;
          return result;
        },
        (): ControllerStreamResult => {
          settled = true;
          return { status: "suppressed" };
        },
      );
      await Promise.race([work, sleep(ackDelayMs)]);
      if (!settled && !closed) {
        const ack =
          `${VOICE_STREAM_ACKNOWLEDGEMENT}${VOICE_STREAM_FLUSH_TAG}`;
        if (write(frame({ content: ack }, null))) {
          try {
            options.lifecycle?.onAcknowledgement?.();
          } catch { /* telemetry never changes streaming */ }
        }
      }

      const result = await work;
      if (closed) {
        done("aborted");
        return;
      }
      if (result.status !== "speak") {
        done("suppressed");
        return;
      }

      // 3. Canonical spoken content in small ordered chunks.
      const chunks = splitSpokenChunks(result.spoken, options.chunkChars);
      for (let index = 0; index < chunks.length; index++) {
        const content = index === 0 ? chunks[index] : ` ${chunks[index]}`;
        if (!write(frame({ content }, null))) break;
      }
      write(frame({}, "stop", {
        bluladder: {
          buildId: options.buildId,
          action: result.metadata?.action ?? { kind: "speak" },
          state: result.metadata?.state ?? "workflow_controller",
          route: result.metadata?.route ?? "controller",
          ...(result.metadata?.event ? { event: result.metadata.event } : {}),
        },
      }));
      done("speak");
    },
    cancel() {
      // Provider disconnect: stop writing. run() already started and owns its
      // own idempotency/mark-uncertain semantics; it is never re-invoked.
      closed = true;
    },
  });
}
```

## 2. `supabase/functions/voice-llm-adapter/index.ts` — precise hunks

Hunk A — import the writer (after line 48):

```diff
 } from "../_shared/voice/voiceTurnLatency.ts";
+import {
+  buildControllerStreamBody,
+  type ControllerStreamResult,
+} from "../_shared/voice/voiceControllerStream.ts";
```

Hunk B — replace the controller branch body (`index.ts:522-677`). The existing `try { ... }` contents become a single `runControllerTurn()` closure; every existing log line, latency `mark`/`add`, `completeVoiceTurn`, `isAuthoritativeVoiceTurn`, stale suppression, and `catch`/`markVoiceTurnUncertain` statement is preserved verbatim inside it.

```diff
 if (decision.route === "controller") {
-    try {
-      const route = await executeControllerRoute({ ... });
-      ...
-      return buildStreamingTextResponse(model, spoken, {}, { ... });
-    } catch { ... }
+  const runControllerTurn = async (): Promise<ControllerStreamResult> => {
+    try {
+      const route = await executeControllerRoute({ /* unchanged args */ });
+      /* unchanged latency marks/adds and structured log */
+      await completeVoiceTurn(supabase, { /* unchanged */ });
+      const authoritative = await isAuthoritativeVoiceTurn(supabase, { /* unchanged */ });
+      latency.add("databaseMs", performance.now() - completionStarted);
+      if (!authoritative) {
+        emitVoiceTurnLatency(latency.finish({
+          route: "single_flight",
+          outcome: "stale_suppressed",
+        }));
+        return { status: "suppressed" };
+      }
+      return {
+        status: "speak",
+        spoken: route.spoken,
+        metadata: { event: route.event },
+      };
+    } catch {
+      console.warn(JSON.stringify({
+        at: "voice-llm-adapter",
+        buildId: BUILD_ID,
+        route: "controller",
+        reason: "workflow_controller_failed_closed",
+      }));
+      await markVoiceTurnUncertain(supabase, { /* unchanged */ });
+      emitVoiceTurnLatency(latency.finish({
+        route: "controller",
+        outcome: "uncertain_suppressed",
+      }));
+      return { status: "suppressed" };
+    }
+  };
+
+  // Non-streaming behavior is unchanged: fully resolve, then respond.
+  if (!request.stream) {
+    const result = await runControllerTurn();
+    if (result.status !== "speak") {
+      return buildSilentVoiceResponse(model, false);
+    }
+    return finishImmediate(
+      buildNonStreamingResponse(
+        model,
+        buildControllerCompletion(result.spoken, result.metadata?.event),
+      ),
+      "controller",
+      "responded",
+    );
+  }
+
+  // Streaming: return the SSE Response now; controller work runs inside it.
+  return new Response(
+    buildControllerStreamBody({
+      model,
+      buildId: BUILD_ID,
+      run: runControllerTurn,
+      lifecycle: {
+        onFirstChunk: () => latency.mark("firstResponseChunkMs"),
+        onComplete: (status) => {
+          if (status === "speak") {
+            emitVoiceTurnLatency(latency.finish({
+              route: "controller",
+              outcome: "responded",
+            }));
+          }
+        },
+      },
+    }),
+    {
+      status: 200,
+      headers: {
+        ...corsHeaders,
+        "Content-Type": "text/event-stream; charset=utf-8",
+        "Cache-Control": "no-cache, no-transform",
+        "Connection": "keep-alive",
+      },
+    },
+  );
 }
```

Notes:
- `latency.finish()` is already single-shot, so a suppressed outcome emitted inside `runControllerTurn` cannot double-emit at `onComplete`.
- `firstResponseChunkMs` now records the actual first byte (the role delta); `responseCompletedMs` is stamped by `finish()` at real stream completion.
- `buildStreamingTextResponse` stays for `buildAuthorityBlockedResponse` (pre-work, sub-millisecond, no ack needed).
- `buildControllerCompletion(spoken, event)` is a small local helper holding the existing `completion` object literal (`index.ts:585-595`).
- The legacy compatibility streaming branch (`index.ts:731-837`) is untouched.

## 3. `supabase/functions/_shared/voiceProviderConfig.ts` — hunks

```diff
+  /** Fail-closed: no provider-side end-call phrase detection. */
+  endCallPhrases: [];
   phoneNumber: null;
```

```diff
+    endCallPhrases: [],
     phoneNumber: null,
```

## 4. `supabase/functions/_shared/voiceProviderReconciliation.ts` — hunks

```diff
     serverMessages: [...manifest.serverEvents.events],
+    endCallPhrases: [...manifest.endCallPhrases],
     maxDurationSeconds: manifest.duration.maxDurationSeconds,
```

```diff
+  // Fail-closed: any saved legacy phrase is an issue. Vapi may canonicalize an
+  // empty list by omitting the field, which is semantically equivalent.
+  if (
+    assistant.endCallPhrases !== undefined &&
+    assistant.endCallPhrases !== null
+  ) {
+    expectJson(issues, "endCallPhrases", assistant.endCallPhrases, []);
+  }
```

Nothing else changes: `credentialIds`, `server.url`, `server.headers`, `model.url`, `voice`, and phone-number handling are untouched, so credentials/server/voice are never mutated by the bounded PATCH.

## 5. Contract-check exact-path updates (item 10)

`scripts/check-voice-artifact-retention-contract.mjs` is the only script that reads the manifest and reconciliation module by exact path. Additions:

```diff
 requireFragments(manifest, "Vapi manifest", [
   '"BluLadder Voice Beta (isolated)"',
+  "endCallPhrases: [],",
```

```diff
 requireFragments(reconciliation, "Vapi raw reconciliation", [
+  "endCallPhrases: [...manifest.endCallPhrases]",
```

```diff
 requireFragments(provisioning, "Vapi provisioning runbook", [
+  "endCallPhrases = empty",
```

`scripts/check-provider-config-contract.mjs` and `scripts/check-voice-booking-contract.mjs` need no change (they assert surface/booking checklists, not these fields). CI already runs `deno test --allow-all supabase/functions/_shared`, so both new test files are collected with no workflow edit.

## 6. Tests (deterministic, no network, no live provider)

`voiceControllerStream_test.ts` — injected `sleep` and deferred promises, frames read from the stream:
- role delta is the first frame and arrives before `run()` resolves;
- slow run emits exactly one ack containing `<flush />`, and the ack text contains no digits, `$`, "book", "sent", "confirmed", address or name tokens;
- fast run emits no ack;
- ordered chunk reconstruction: concatenated content deltas equal the canonical spoken text; final frame is `finish_reason: "stop"` followed by `[DONE]`;
- `run()` rejecting and `run()` returning `suppressed` both emit zero content deltas, a clean `[DONE]`, and `onComplete("suppressed")`;
- cancel mid-flight: no uncaught error, `run()` invoked exactly once, no frames after cancel;
- lifecycle: `onFirstChunk` fires at the role delta, `onComplete` fires once only.

`voiceProviderEndCallPhrases_test.ts`:
- manifest builder yields `endCallPhrases: []`;
- `buildVapiAssistantPatch` includes `endCallPhrases: []` and still rejects a model URL/provider mismatch;
- `verifyVapiAssistantSnapshot` passes on `[]` and on an omitted field, and fails on `["goodbye","bye"]` (drift);
- no fixture contains a phone number, address, email, or credential value.

## 7. Commands

Focused:
```bash
deno fmt --check supabase/functions/_shared/voice/voiceControllerStream.ts \
  supabase/functions/_shared/voice/voiceControllerStream_test.ts \
  supabase/functions/_shared/voiceProviderEndCallPhrases_test.ts \
  supabase/functions/_shared/voiceProviderConfig.ts \
  supabase/functions/_shared/voiceProviderReconciliation.ts \
  supabase/functions/voice-llm-adapter/index.ts
deno lint supabase/functions/_shared/voice/voiceControllerStream.ts supabase/functions/voice-llm-adapter/index.ts
deno test --allow-all supabase/functions/_shared/voice/voiceControllerStream_test.ts
deno test --allow-all supabase/functions/_shared/voiceProviderEndCallPhrases_test.ts
deno check supabase/functions/voice-llm-adapter/index.ts
bun run check:voice-artifact-retention-contract
```

Full gate:
```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
deno test --allow-all supabase/functions/_shared
bun run check:provider-config-contract
bun run check:voice-booking-contract
bun run check:voice-artifact-retention-contract
bun run check:voice-artifact-retention-lovable-release
```

## Risks

- The ack is spoken to real callers. At a 1200 ms threshold most turns (4.7-7.7 s observed) will hear it; if that is too chatty only the constant changes.
- `<flush />` requires `voice.chunkPlan.enabled = true` on the saved assistant. This patch does not touch `voice`; if chunkPlan were ever disabled the literal tag could be spoken. Mitigation: confirm chunkPlan in the read-only preflight before deploy, or gate the ack behind an env flag.
- Streaming now performs DB work after headers are sent, so a mid-stream failure yields role + `[DONE]` with no speech — the same silence class as today, never a wrong claim.
- Removing `endCallPhrases` means "goodbye" no longer auto-hangs-up; the 900 s cap, `hang`, and end-of-call handling remain.
- Provider key-ordering canonicalization has already caused verification noise; `expectJson` is order-insensitive at the object level but a reordered non-empty phrase list still fails (correct, fail-closed).
- Out of scope here: deployment, secret changes, and the live Vapi PATCH. Each needs separate owner authorization.
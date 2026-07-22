// ============================================================================
// voice-vapi-tune — one-shot administrative endpoint used exactly once to
// patch the isolated Vapi voice-beta assistant with Phase 4C-β.3D speech
// configuration and verify artifact suppression. Requires X-Diag-Token equal
// to VOICE_VAPI_TUNE_TOKEN. This function must be deleted after use.
//
// Never returns transcripts, artifact URLs, monitor/control URLs, secrets, or
// the Authorization header. Reads structural fields only.
// ============================================================================
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASSISTANT_ID = "d48196aa-4ffc-499d-bea7-25b1ee15a53e";
const VAPI_BASE = "https://api.vapi.ai";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function structuralView(j: any): any {
  return {
    firstMessagePresent: typeof j?.firstMessage === "string" && j.firstMessage.length > 0,
    firstMessageLen: typeof j?.firstMessage === "string" ? j.firstMessage.length : 0,
    firstMessageMode: j?.firstMessageMode ?? null,
    firstMessageInterruptionsEnabled: j?.firstMessageInterruptionsEnabled ?? null,
    startSpeakingPlan: j?.startSpeakingPlan ?? null,
    stopSpeakingPlan: j?.stopSpeakingPlan ?? null,
    voice: j?.voice ? {
      provider: j.voice.provider ?? null,
      voiceId: j.voice.voiceId ?? null,
      chunkPlanEnabled: j.voice.chunkPlan?.enabled ?? null,
      chunkPlanMinCharacters: j.voice.chunkPlan?.minCharacters ?? null,
    } : null,
    transcriber: j?.transcriber ? {
      provider: j.transcriber.provider, model: j.transcriber.model, language: j.transcriber.language,
    } : null,
    model: j?.model ? {
      provider: j.model.provider, model: j.model.model,
      toolsCount: Array.isArray(j.model.tools) ? j.model.tools.length : 0,
    } : null,
    artifactPlan: j?.artifactPlan ? {
      recordingEnabled: j.artifactPlan.recordingEnabled ?? null,
      videoRecordingEnabled: j.artifactPlan.videoRecordingEnabled ?? null,
      pcapEnabled: j.artifactPlan.pcapEnabled ?? null,
      loggingEnabled: j.artifactPlan.loggingEnabled ?? null,
      transcriptPlanEnabled: j.artifactPlan.transcriptPlan?.enabled ?? null,
    } : null,
    analysisPlan: j?.analysisPlan ? {
      summaryPlanEnabled: j.analysisPlan.summaryPlan?.enabled ?? null,
      structuredDataPlanEnabled: j.analysisPlan.structuredDataPlan?.enabled ?? null,
      successEvaluationPlanEnabled: j.analysisPlan.successEvaluationPlan?.enabled ?? null,
    } : null,
    maxDurationSeconds: j?.maxDurationSeconds ?? null,
    phoneNumberIdPresent: !!j?.phoneNumberId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = Deno.env.get("VOICE_VAPI_TUNE_TOKEN");
  if (!token || req.headers.get("x-diag-token") !== token) return json(401, { error: "unauthorized" });
  const key = Deno.env.get("VAPI_API_KEY");
  if (!key) return json(500, { error: "no_vapi_key" });
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  if (action === "get") {
    const r = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, { headers: h });
    const j = await r.json().catch(() => ({}));
    return json(200, { status: r.status, structural: structuralView(j) });
  }

  if (action === "patch") {
    // Phase 4C-β.3D bounded patch. Only speech-timing fields are touched.
    // Custom LLM URL, secret, transcriber, tools, phone, transfer are NOT.
    const patch = {
      firstMessage: "Thanks for calling BluLadder. How can I help you today?",
      firstMessageMode: "assistant-speaks-first",
      firstMessageInterruptionsEnabled: true,
      startSpeakingPlan: { waitSeconds: 0.2 },
      stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 0.5 },
      voice: {
        provider: "vapi",
        voiceId: "Clara",
        chunkPlan: { enabled: true, minCharacters: 30 },
      },
      // Explicit artifact suppression (idempotent; leave existing values if
      // Vapi has already fixed these to false).
      artifactPlan: {
        recordingEnabled: false,
        videoRecordingEnabled: false,
        pcapEnabled: false,
        loggingEnabled: false,
        transcriptPlan: { enabled: false },
      },
      analysisPlan: {
        summaryPlan: { enabled: false },
        structuredDataPlan: { enabled: false },
        successEvaluationPlan: { enabled: false },
      },
    };
    const before = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, { headers: h });
    const beforeJson = await before.json().catch(() => ({}));
    const beforeView = structuralView(beforeJson);
    const patchResp = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
      method: "PATCH", headers: h, body: JSON.stringify(patch),
    });
    const patchText = await patchResp.text().catch(() => "");
    const after = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, { headers: h });
    const afterJson = await after.json().catch(() => ({}));
    const afterView = structuralView(afterJson);
    return json(200, {
      patchStatus: patchResp.status,
      patchErrorTextLen: patchText.length,
      before: beforeView,
      after: afterView,
      // Explicit boundary invariants: fields that MUST NOT change.
      invariants: {
        modelProviderUnchanged: beforeView.model?.provider === afterView.model?.provider,
        transcriberProviderUnchanged: beforeView.transcriber?.provider === afterView.transcriber?.provider,
        toolsCountUnchanged: (beforeView.model?.toolsCount ?? 0) === (afterView.model?.toolsCount ?? 0),
        maxDurationUnchanged: beforeView.maxDurationSeconds === afterView.maxDurationSeconds,
        phoneNumberStillAbsent: !afterView.phoneNumberIdPresent,
      },
    });
  }

  return json(400, { error: "unknown_action" });
});

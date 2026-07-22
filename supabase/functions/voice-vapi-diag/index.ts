// One-shot sanitized diagnostic for a single Vapi call. Deleted after use.
// Returns only allow-listed timing + structural fields. Never returns
// transcript, message content, recording URLs, monitor URLs, phone numbers,
// or secrets.

const CALL_ID = "019f8841-5234-7dde-befd-838f26f53c9f";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// No auth: function is scoped to one hardcoded CALL_ID, returns sanitized
// fields only, and is deleted immediately after single use.

function summarizeArtifact(art: any): Record<string, unknown> {
  if (!art || typeof art !== "object") return { present: false };
  const messagesLen = Array.isArray(art.messages) ? art.messages.length
    : Array.isArray(art.messagesOpenAIFormatted) ? art.messagesOpenAIFormatted.length : null;
  const transcriptLen = typeof art.transcript === "string" ? art.transcript.length
    : (art.transcript == null ? null : -1);
  return {
    present: true,
    recordingUrl: art.recordingUrl == null ? null : "present",
    stereoRecordingUrl: art.stereoRecordingUrl == null ? null : "present",
    customerRecordingUrl: art.customerRecordingUrl == null ? null : "present",
    assistantRecordingUrl: art.assistantRecordingUrl == null ? null : "present",
    videoRecordingUrl: art.videoRecordingUrl == null ? null : "present",
    pcapUrl: art.pcapUrl == null ? null : "present",
    transcriptChars: transcriptLen,
    messagesLength: messagesLen,
    summaryPresent: typeof art.summary === "string" && art.summary.length > 0,
    structuredOutputPresent: art.structuredOutput != null,
    logUrl: art.logUrl == null ? null : "present",
  };
}

function summarizeTurns(turns: any[] | undefined) {
  if (!Array.isArray(turns)) return [];
  return turns.map((t, i) => ({
    idx: i,
    total: t?.total ?? null,
    endpointing: t?.endpointing ?? null,
    transcriber: t?.transcriber ?? null,
    model: t?.model ?? null,
    voice: t?.voice ?? null,
    fromTransport: t?.fromTransport ?? null,
    toTransport: t?.toTransport ?? null,
  }));
}

function summarizeAssistant(a: any): Record<string, unknown> {
  if (!a || typeof a !== "object") return { present: false };
  return {
    firstMessagePresent: typeof a.firstMessage === "string" && a.firstMessage.length > 0,
    firstMessageChars: typeof a.firstMessage === "string" ? a.firstMessage.length : null,
    firstMessageInterruptionsEnabled: a.firstMessageInterruptionsEnabled ?? null,
    startSpeakingPlanWaitSeconds: a.startSpeakingPlan?.waitSeconds ?? null,
    stopSpeakingPlanPresent: a.stopSpeakingPlan != null,
    voiceProvider: a.voice?.provider ?? null,
    voiceId: a.voice?.voiceId ?? null,
    voiceChunkPlanEnabled: a.voice?.chunkPlan?.enabled ?? null,
    transcriberProvider: a.transcriber?.provider ?? null,
    transcriberModel: a.transcriber?.model ?? null,
    transcriberLanguage: a.transcriber?.language ?? null,
    modelProvider: a.model?.provider ?? null,
    toolsCount: Array.isArray(a.model?.tools) ? a.model.tools.length : 0,
    recordingEnabled: a.artifactPlan?.recordingEnabled ?? null,
    transcriptPlanEnabled: a.artifactPlan?.transcriptPlan?.enabled ?? null,
    videoRecordingEnabled: a.artifactPlan?.videoRecordingEnabled ?? null,
    pcapEnabled: a.artifactPlan?.pcapEnabled ?? null,
    loggingEnabled: a.observabilityPlan?.enabled ?? a.loggingEnabled ?? null,
  };
}

function summarizeCall(c: any): Record<string, unknown> {
  const pm = c?.artifact?.performanceMetrics || c?.performanceMetrics || {};
  return {
    type: c?.type ?? null,
    endedReason: c?.endedReason ?? null,
    startedAt: c?.startedAt ?? null,
    endedAt: c?.endedAt ?? null,
    phoneNumberIdPresent: c?.phoneNumberId != null,
    customerPresent: c?.customer != null,
    customerNumberPresent: c?.customer?.number != null,
    monitor: {
      listenUrlPresent: c?.monitor?.listenUrl != null,
      controlUrlPresent: c?.monitor?.controlUrl != null,
    },
    averages: {
      turnLatencyAverage: pm.turnLatencyAverage ?? null,
      endpointingLatencyAverage: pm.endpointingLatencyAverage ?? null,
      transcriberLatencyAverage: pm.transcriberLatencyAverage ?? null,
      modelLatencyAverage: pm.modelLatencyAverage ?? null,
      voiceLatencyAverage: pm.voiceLatencyAverage ?? null,
      fromTransportLatencyAverage: pm.fromTransportLatencyAverage ?? null,
      toTransportLatencyAverage: pm.toTransportLatencyAverage ?? null,
    },
    turns: summarizeTurns(pm.turnLatencies),
    artifact: summarizeArtifact(c?.artifact),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const vapiKey = Deno.env.get("VAPI_API_KEY");
  if (!vapiKey) return json(500, { error: "env_missing" });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "measure";
  const H = { Authorization: `Bearer ${vapiKey}` };

  if (action === "measure") {
    const callRes = await fetch(`https://api.vapi.ai/call/${CALL_ID}`, { headers: H });
    if (!callRes.ok) return json(callRes.status, { step: "call", status: callRes.status });
    const call = await callRes.json();
    const assistantId = call?.assistantId;
    let assistantSummary: unknown = null;
    if (assistantId) {
      const aRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, { headers: H });
      if (aRes.ok) assistantSummary = summarizeAssistant(await aRes.json());
      else assistantSummary = { error: aRes.status };
    }
    return json(200, { call: summarizeCall(call), assistant: assistantSummary });
  }

  if (action === "delete") {
    const del = await fetch(`https://api.vapi.ai/call/${CALL_ID}`, { method: "DELETE", headers: H });
    const delStatus = del.status;
    const reget = await fetch(`https://api.vapi.ai/call/${CALL_ID}`, { headers: H });
    let regetBody: any = null;
    try { regetBody = await reget.json(); } catch { /* */ }
    return json(200, {
      deleteStatus: delStatus,
      regetStatus: reget.status,
      regetShape: regetBody && typeof regetBody === "object"
        ? {
            hasId: regetBody.id != null,
            endedReason: regetBody.endedReason ?? null,
            artifactPresent: regetBody.artifact != null,
            recordingUrlPresent: regetBody?.artifact?.recordingUrl != null,
            transcriptPresent: regetBody?.artifact?.transcript != null,
            errorMessagePresent: typeof regetBody.message === "string",
          }
        : null,
    });
  }

  return json(400, { error: "unknown_action" });
});
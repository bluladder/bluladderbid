// One-shot sanitized diagnostic for a specific Vapi call. Never returns
// transcript content, phone numbers, monitor/control URLs, recording URLs,
// or authorization headers. Requires header X-Diag-Token matching env
// VOICE_VAPI_DIAG_TOKEN.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pathsOf(obj: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length > 400) return out;
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      if (obj.length > 0) pathsOf(obj[0], `${prefix}[0]`, out, depth + 1);
    } else {
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        const p = prefix ? `${prefix}.${k}` : k;
        out.push(p);
        pathsOf((obj as Record<string, unknown>)[k], p, out, depth + 1);
      }
    }
  }
  return out;
}

function sanitizeMetrics(pm: unknown): unknown {
  if (!pm || typeof pm !== "object") return null;
  const p = pm as Record<string, unknown>;
  const allowed = [
    "turnLatencyAverage",
    "endpointingLatencyAverage",
    "transcriberLatencyAverage",
    "modelLatencyAverage",
    "voiceLatencyAverage",
    "fromTransportLatencyAverage",
    "toTransportLatencyAverage",
  ];
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  const turns = (p as any).turnLatencies;
  if (Array.isArray(turns)) {
    out.turnLatencies = turns.slice(0, 40).map((t: any, i: number) => ({
      turn: i,
      total: t?.total ?? t?.turnLatency ?? null,
      endpointing: t?.endpointing ?? null,
      transcriber: t?.transcriber ?? null,
      model: t?.model ?? null,
      voice: t?.voice ?? null,
      fromTransport: t?.fromTransport ?? null,
      toTransport: t?.toTransport ?? null,
    }));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = Deno.env.get("VOICE_VAPI_DIAG_TOKEN");
  if (!token || req.headers.get("x-diag-token") !== token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const vapi = Deno.env.get("VAPI_API_KEY");
  if (!vapi) return new Response(JSON.stringify({ error: "no_vapi_key" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  const base = "https://api.vapi.ai";
  const h = { Authorization: `Bearer ${vapi}`, "Content-Type": "application/json" };

  if (action === "get_call") {
    const id = body.id as string;
    const r = await fetch(`${base}/call/${id}`, { headers: h });
    const j = await r.json().catch(() => ({}));
    const paths = pathsOf(j);
    // Structural presence flags without leaking values
    const structural = {
      hasId: typeof j?.id === "string",
      idMatches: j?.id === id,
      assistantIdPresent: typeof j?.assistantId === "string",
      type: j?.type ?? null,
      status: j?.status ?? null,
      endedReason: j?.endedReason ?? null,
      startedAtPresent: !!j?.startedAt,
      endedAtPresent: !!j?.endedAt,
      createdAtPresent: !!j?.createdAt,
      updatedAtPresent: !!j?.updatedAt,
      hasPerformanceMetrics: !!(j as any)?.performanceMetrics || !!(j as any)?.analysis?.performanceMetrics,
      hasMonitor: !!(j as any)?.monitor,
      hasControlUrl: !!(j as any)?.monitor?.controlUrl || !!(j as any)?.controlUrl,
      hasRecordingUrl: !!(j as any)?.recordingUrl || !!(j as any)?.artifact?.recordingUrl,
      hasTranscript: !!(j as any)?.transcript || !!(j as any)?.artifact?.transcript,
      hasMessages: Array.isArray((j as any)?.messages) || Array.isArray((j as any)?.artifact?.messages),
      customerPresent: !!(j as any)?.customer,
      phoneNumberIdPresent: !!(j as any)?.phoneNumberId,
      // PSTN indicators absent for browser calls
      pstnFieldsAbsent: !((j as any)?.phoneNumber || (j as any)?.phoneNumberId || (j as any)?.customer?.number),
      cost: typeof (j as any)?.cost === "number" ? (j as any).cost : null,
    };
    const pm = (j as any)?.performanceMetrics
      ?? (j as any)?.artifact?.performanceMetrics
      ?? (j as any)?.analysis?.performanceMetrics
      ?? null;
    return new Response(JSON.stringify({
      status: r.status,
      structural,
      keyPaths: paths.slice(0, 300),
      metrics: sanitizeMetrics(pm),
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  if (action === "get_assistant") {
    const id = body.id as string;
    const r = await fetch(`${base}/assistant/${id}`, { headers: h });
    const j: any = await r.json().catch(() => ({}));
    // Report only speech-timing-relevant structural fields (no secrets, no URLs)
    const timing = {
      firstMessagePresent: typeof j?.firstMessage === "string" && j.firstMessage.length > 0,
      firstMessageLen: typeof j?.firstMessage === "string" ? j.firstMessage.length : 0,
      firstMessageMode: j?.firstMessageMode ?? null,
      firstMessageInterruptionsEnabled: j?.firstMessageInterruptionsEnabled ?? null,
      startSpeakingPlan: j?.startSpeakingPlan ?? null,
      stopSpeakingPlan: j?.stopSpeakingPlan ?? null,
      voice: j?.voice ? {
        provider: j.voice.provider ?? null,
        voiceId: j.voice.voiceId ?? null,
        model: j.voice.model ?? null,
        chunkPlanPresent: !!j.voice.chunkPlan,
        chunkPlan: j.voice.chunkPlan ?? null,
      } : null,
      transcriber: j?.transcriber ? {
        provider: j.transcriber.provider,
        model: j.transcriber.model,
        language: j.transcriber.language,
        endpointing: j.transcriber.endpointing ?? null,
      } : null,
      model: j?.model ? {
        provider: j.model.provider,
        model: j.model.model,
        maxTokens: j.model.maxTokens ?? null,
        temperature: j.model.temperature ?? null,
        toolsCount: Array.isArray(j.model.tools) ? j.model.tools.length : 0,
        promptLen: (j.model.messages ?? []).reduce((n: number, m: any) => n + (typeof m?.content === "string" ? m.content.length : 0), 0),
      } : null,
      backgroundSound: j?.backgroundSound ?? null,
      silenceTimeoutSeconds: j?.silenceTimeoutSeconds ?? null,
      responseDelaySeconds: j?.responseDelaySeconds ?? null,
      llmRequestDelaySeconds: j?.llmRequestDelaySeconds ?? null,
      numWordsToInterruptAssistant: j?.numWordsToInterruptAssistant ?? null,
      maxDurationSeconds: j?.maxDurationSeconds ?? null,
    };
    return new Response(JSON.stringify({ status: r.status, timing }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  if (action === "delete_call") {
    const id = body.id as string;
    const r = await fetch(`${base}/call/${id}`, { method: "DELETE", headers: h });
    let after = 0;
    try { const rr = await fetch(`${base}/call/${id}`, { headers: h }); after = rr.status; } catch {}
    return new Response(JSON.stringify({ deleteStatus: r.status, followupGetStatus: after }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
});
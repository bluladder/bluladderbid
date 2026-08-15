import type { JobTreadExecutionResult } from "../_shared/jobtreadExecutionRunner.ts";
import {
  parseKlamathJobTreadReadRuntimeRequest,
} from "../_shared/jobtreadKlamathReadRuntime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
};
const MAX_BODY_BYTES = 4_096;

export interface KlamathJobTreadReadHandlerDependencies {
  authorize(req: Request): Promise<boolean>;
  execute(request: unknown): Promise<JobTreadExecutionResult>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function failureStatus(code: string): number {
  if (
    code === "connector_inactive" ||
    code === "credential_reference_missing" ||
    code === "provider_unavailable"
  ) return 503;
  if (code === "organization_lineage_mismatch") return 409;
  return 422;
}

async function readBoundedJson(
  req: Request,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string }
> {
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (!Number.isInteger(declaredLength) || declaredLength < 0) {
      return { ok: false, status: 400, error: "invalid_request" };
    }
    if (declaredLength > MAX_BODY_BYTES) {
      return { ok: false, status: 413, error: "request_too_large" };
    }
  }
  if (!req.body) return { ok: false, status: 400, error: "invalid_request" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, error: "request_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "invalid_request" };
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(bytes)),
    };
  } catch {
    return { ok: false, status: 400, error: "invalid_request" };
  }
}

export function createKlamathJobTreadReadHandler(
  dependencies: KlamathJobTreadReadHandlerDependencies,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (!await dependencies.authorize(req)) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = await readBoundedJson(req);
    if (!body.ok) return json({ error: body.error }, body.status);
    const parsed = parseKlamathJobTreadReadRuntimeRequest(body.value);
    if (!parsed) return json({ error: "invalid_request" }, 400);

    const result = await dependencies.execute(parsed);
    if (result.status === "ok") {
      return json({
        status: "ok",
        capability: parsed.capability,
        outcome: {
          step: result.value.step,
          recordCount: result.value.recordCount,
          nextPagePresent: result.value.nextPagePresent,
        },
      }, 200);
    }
    return json({
      status: "manual_review",
      code: result.code,
      retryable: result.retryable,
    }, failureStatus(result.code));
  };
}

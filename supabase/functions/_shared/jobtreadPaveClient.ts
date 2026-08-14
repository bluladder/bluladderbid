export const JOBTREAD_PAVE_ENDPOINT = "https://api.jobtread.com/pave";

export type JobTreadPaveFailureCode =
  | "credential_missing"
  | "invalid_query"
  | "transport_error"
  | "provider_unavailable"
  | "provider_rejected"
  | "malformed_response";

export type JobTreadPaveResult<T> =
  | {
    status: "ok";
    data: T;
    httpStatus: number;
  }
  | {
    status: "error";
    code: JobTreadPaveFailureCode;
    retryable: boolean;
    outcomeUncertain: boolean;
    httpStatus: number | null;
  };

export interface JobTreadPaveRequest<TQuery extends Record<string, unknown>> {
  grantKey: string;
  query: TQuery;
  mutation?: boolean;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsGrantKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGrantKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    key.toLowerCase() === "grantkey" || containsGrantKey(child)
  );
}

function errorResult(
  code: JobTreadPaveFailureCode,
  options: {
    retryable?: boolean;
    outcomeUncertain?: boolean;
    httpStatus?: number | null;
  } = {},
): JobTreadPaveResult<never> {
  return {
    status: "error",
    code,
    retryable: options.retryable ?? false,
    outcomeUncertain: options.outcomeUncertain ?? false,
    httpStatus: options.httpStatus ?? null,
  };
}

/**
 * Execute one JobTread Pave request without ever returning provider error text,
 * request bodies, headers, or grant material. Mutations are never retried here:
 * an interrupted or malformed successful/server response is outcome-uncertain
 * and must be reconciled by the caller under its stable idempotency record.
 */
export async function executeJobTreadPave<
  TResponse,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
>(
  request: JobTreadPaveRequest<TQuery>,
): Promise<JobTreadPaveResult<TResponse>> {
  const grantKey = request.grantKey.trim();
  if (!grantKey) return errorResult("credential_missing");
  if (
    !isRecord(request.query) ||
    Object.keys(request.query).length === 0 ||
    Object.prototype.hasOwnProperty.call(request.query, "$") ||
    containsGrantKey(request.query)
  ) {
    return errorResult("invalid_query");
  }

  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(JOBTREAD_PAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          $: { grantKey },
          ...request.query,
        },
      }),
    });
  } catch {
    return errorResult("transport_error", {
      retryable: true,
      outcomeUncertain: request.mutation === true,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return errorResult("malformed_response", {
      retryable: response.status >= 500,
      outcomeUncertain: request.mutation === true &&
        (response.ok || response.status >= 500),
      httpStatus: response.status,
    });
  }

  if (!response.ok) {
    const unavailable = response.status === 429 || response.status >= 500;
    return errorResult(
      unavailable ? "provider_unavailable" : "provider_rejected",
      {
        retryable: unavailable,
        outcomeUncertain: request.mutation === true && response.status >= 500,
        httpStatus: response.status,
      },
    );
  }

  if (!isRecord(payload)) {
    return errorResult("malformed_response", {
      outcomeUncertain: request.mutation === true,
      httpStatus: response.status,
    });
  }
  if (
    (Object.prototype.hasOwnProperty.call(payload, "errors") &&
      payload.errors != null) ||
    (Object.prototype.hasOwnProperty.call(payload, "error") &&
      payload.error != null)
  ) {
    return errorResult("provider_rejected", {
      outcomeUncertain: request.mutation === true,
      httpStatus: response.status,
    });
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  return {
    status: "ok",
    data: data as TResponse,
    httpStatus: response.status,
  };
}

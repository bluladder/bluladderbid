// Deferred OpenAI-compatible SSE writer for one authoritative voice turn.
export const VOICE_STREAM_ACK_DELAY_MS = 1_200;
export const VOICE_STREAM_ACKNOWLEDGEMENT = "One moment.";
export const VOICE_STREAM_FLUSH_TAG = " <flush />";
export const VOICE_STREAM_CHUNK_CHARS = 80;

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
  onComplete?: (
    status: "speak" | "suppressed" | "aborted",
  ) => void;
}

export interface ControllerStreamOptions {
  model: string;
  buildId: string;
  run: () => Promise<ControllerStreamResult>;
  ackDelayMs?: number;
  chunkChars?: number;
  lifecycle?: ControllerStreamLifecycle;
  scheduleDelay?: (ms: number) => {
    promise: Promise<void>;
    cancel: () => void;
  };
}

export function splitSpokenChunks(
  spoken: string,
  maxChars = VOICE_STREAM_CHUNK_CHARS,
): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError("maxChars must be a positive integer");
  }
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

export function buildControllerStreamResponse(
  options: ControllerStreamOptions,
): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1_000);
  const ackDelayMs = options.ackDelayMs ?? VOICE_STREAM_ACK_DELAY_MS;
  const scheduleDelay = options.scheduleDelay ?? ((ms: number) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return {
      promise: new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, ms);
      }),
      cancel: () => {
        if (timeout !== undefined) clearTimeout(timeout);
      },
    };
  });
  let closed = false;
  let firstChunkSeen = false;
  let completeSeen = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const complete = (
        status: "speak" | "suppressed" | "aborted",
      ) => {
        if (completeSeen) return;
        completeSeen = true;
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch {
            closed = true;
          }
        }
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The provider may already have disconnected.
          }
        }
        try {
          options.lifecycle?.onComplete?.(status);
        } catch {
          // Telemetry must never change streaming.
        }
      };
      const write = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          );
        } catch {
          closed = true;
          return false;
        }
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          try {
            options.lifecycle?.onFirstChunk?.();
          } catch {
            // Telemetry must never change streaming.
          }
        }
        return true;
      };
      const frame = (
        delta: Record<string, unknown>,
        finishReason: "stop" | null,
        extra: Record<string, unknown> = {},
      ) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model: options.model,
        choices: [{
          index: 0,
          delta,
          finish_reason: finishReason,
        }],
        ...extra,
      });

      if (!write(frame({ role: "assistant" }, null))) {
        complete("aborted");
        return;
      }

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
      const delay = scheduleDelay(Math.max(0, ackDelayMs));
      await Promise.race([work, delay.promise]);
      delay.cancel();

      let acknowledgementEmitted = false;
      if (!settled && !closed) {
        acknowledgementEmitted = write(frame({
          content: `${VOICE_STREAM_ACKNOWLEDGEMENT}${VOICE_STREAM_FLUSH_TAG}`,
        }, null));
        if (acknowledgementEmitted) {
          try {
            options.lifecycle?.onAcknowledgement?.();
          } catch {
            // Telemetry must never change streaming.
          }
        }
      }

      const result = await work;
      if (closed) {
        complete("aborted");
        return;
      }
      if (result.status !== "speak" || !result.spoken.trim()) {
        complete("suppressed");
        return;
      }

      const chunks = splitSpokenChunks(result.spoken, options.chunkChars);
      for (let index = 0; index < chunks.length; index++) {
        const needsSpace = acknowledgementEmitted || index > 0;
        if (
          !write(frame({
            content: needsSpace ? ` ${chunks[index]}` : chunks[index],
          }, null))
        ) {
          complete("aborted");
          return;
        }
      }
      if (
        !write(frame({}, "stop", {
          bluladder: {
            buildId: options.buildId,
            action: result.metadata?.action ?? { kind: "speak" },
            state: result.metadata?.state ?? "workflow_controller",
            route: result.metadata?.route ?? "controller",
            ...(result.metadata?.event ? { event: result.metadata.event } : {}),
          },
        }))
      ) {
        complete("aborted");
        return;
      }
      complete("speak");
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

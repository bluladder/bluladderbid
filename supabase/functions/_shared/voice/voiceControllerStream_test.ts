import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildControllerStreamResponse,
  splitSpokenChunks,
  VOICE_STREAM_ACKNOWLEDGEMENT,
  VOICE_STREAM_FLUSH_TAG,
} from "./voiceControllerStream.ts";

Deno.test("controller stream prefers complete spoken sentences within the bound", () => {
  const spoken =
    "The house number is five, six, one, two. The street is Binbranch Lane. Is that exactly right?";
  const chunks = splitSpokenChunks(spoken, 50);
  assertEquals(chunks, [
    "The house number is five, six, one, two.",
    "The street is Binbranch Lane.",
    "Is that exactly right?",
  ]);
  assertEquals(chunks.join(" "), spoken);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read();
  assert(!done && value);
  return new TextDecoder().decode(value);
}

Deno.test("controller stream emits role before deferred work completes", async () => {
  const work = deferred<{ status: "speak"; spoken: string }>();
  let first = 0;
  const response = buildControllerStreamResponse({
    model: "m",
    buildId: "b",
    run: () => work.promise,
    scheduleDelay: () => ({
      promise: new Promise(() => {}),
      cancel: () => {},
    }),
    lifecycle: { onFirstChunk: () => first++ },
  });
  const reader = response.body!.getReader();
  const role = await readEvent(reader);
  assert(role.includes('"role":"assistant"'));
  assertEquals(first, 1);
  work.resolve({ status: "speak", spoken: "Ready." });
  while (!(await reader.read()).done) { /* drain */ }
});

Deno.test("controller stream emits one neutral flush acknowledgement only when slow", async () => {
  const work = deferred<{ status: "speak"; spoken: string }>();
  const timer = deferred<void>();
  const response = buildControllerStreamResponse({
    model: "m",
    buildId: "b",
    run: () => work.promise,
    scheduleDelay: () => ({ promise: timer.promise, cancel: () => {} }),
  });
  const reader = response.body!.getReader();
  await readEvent(reader);
  timer.resolve();
  const ack = await readEvent(reader);
  assertEquals(VOICE_STREAM_ACKNOWLEDGEMENT, "Got it.");
  assert(ack.includes(VOICE_STREAM_ACKNOWLEDGEMENT));
  assert(ack.includes(VOICE_STREAM_FLUSH_TAG));
  assert(!/[0-9$]/.test(VOICE_STREAM_ACKNOWLEDGEMENT));
  assert(
    !/(book|sent|confirmed|price|address|name)/i.test(
      VOICE_STREAM_ACKNOWLEDGEMENT,
    ),
  );
  work.resolve({ status: "speak", spoken: "What would you like quoted?" });
  let rest = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += new TextDecoder().decode(next.value);
  }
  assertEquals((ack + rest).split(VOICE_STREAM_ACKNOWLEDGEMENT).length - 1, 1);
});

Deno.test("controller stream skips acknowledgement for fast work and reconstructs content", async () => {
  const spoken = "This canonical answer arrives in several ordered pieces.";
  const response = buildControllerStreamResponse({
    model: "m",
    buildId: "b",
    run: () => Promise.resolve({ status: "speak", spoken }),
    ackDelayMs: 10_000,
    chunkChars: 12,
  });
  const text = await response.text();
  assert(!text.includes(VOICE_STREAM_ACKNOWLEDGEMENT));
  const frames = text.split("\n\n").filter((line) => line.startsWith("data: {"))
    .map(
      (line) => JSON.parse(line.slice(6)),
    );
  const content = frames.map((frame) => frame.choices[0].delta.content ?? "")
    .join("");
  assertEquals(content, spoken);
  assertEquals(frames.at(-1).choices[0].finish_reason, "stop");
  assert(text.endsWith("data: [DONE]\n\n"));
});

Deno.test("controller stream suppresses rejected and stale work without business content", async () => {
  for (
    const run of [
      () => Promise.reject(new Error("failed")),
      () => Promise.resolve({ status: "suppressed" as const }),
    ]
  ) {
    const completed: string[] = [];
    const response = buildControllerStreamResponse({
      model: "m",
      buildId: "b",
      run,
      lifecycle: { onComplete: (status) => completed.push(status) },
    });
    const text = await response.text();
    assert(!text.includes('"content"'));
    assert(text.endsWith("data: [DONE]\n\n"));
    assertEquals(completed, ["suppressed"]);
  }
});

Deno.test("controller stream lifecycle completes once for spoken output", async () => {
  let first = 0;
  let firstContent = 0;
  const completed: string[] = [];
  const response = buildControllerStreamResponse({
    model: "m",
    buildId: "b",
    run: () => Promise.resolve({ status: "speak", spoken: "Ready." }),
    lifecycle: {
      onFirstChunk: () => first++,
      onFirstContentChunk: () => firstContent++,
      onComplete: (status) => completed.push(status),
    },
  });
  await response.text();
  assertEquals(first, 1);
  assertEquals(firstContent, 1);
  assertEquals(completed, ["speak"]);
});

Deno.test("controller stream cancellation never starts duplicate work", async () => {
  const work = deferred<{ status: "speak"; spoken: string }>();
  let runs = 0;
  const response = buildControllerStreamResponse({
    model: "m",
    buildId: "b",
    run: () => {
      runs++;
      return work.promise;
    },
    scheduleDelay: () => ({
      promise: new Promise(() => {}),
      cancel: () => {},
    }),
  });
  const reader = response.body!.getReader();
  await readEvent(reader);
  await reader.cancel();
  work.resolve({ status: "speak", spoken: "Must not be emitted." });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(runs, 1);
});

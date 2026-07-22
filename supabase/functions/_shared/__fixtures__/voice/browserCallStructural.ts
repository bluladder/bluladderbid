// Hand-authored sanitized Vapi browser-call fixture. Contains ONLY the
// confirmed whitelisted structure. No transcript, no message content, no
// artifact URLs, no recording objects, no logs, no real ids, no real
// timestamps, no customer data. All string ids are obviously synthetic.
//
// Used only by contract tests to pin the field-path shape without ever
// memorializing prohibited paths.

export const sanitizedBrowserCallFixture = {
  id: "test-call-synthetic-0000",
  assistantId: "test-assistant-synthetic-0000",
  type: "webCall",
  startedAt: "2000-01-01T00:00:00.000Z",
  endedAt: "2000-01-01T00:01:00.000Z",
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:01:05.000Z",
  endedReason: "customer-ended-call",
  artifact: {
    performanceMetrics: {
      turnLatencyAverage: 2200,
      endpointingLatencyAverage: 180,
      transcriberLatencyAverage: 480,
      modelLatencyAverage: 1100,
      voiceLatencyAverage: 320,
      fromTransportLatencyAverage: 20,
      toTransportLatencyAverage: 40,
      turnLatencies: [
        { total: 2100, endpointing: 170, transcriber: 470, model: 1000, voice: 320, fromTransport: 20, toTransport: 40 },
      ],
    },
  },
  monitor: { listenUrlPresent: true, controlUrlPresent: true },
  // Explicit absence markers for browser calls. These are the fields that,
  // if present, indicate a PSTN test rather than a web test.
  phoneNumberIdPresent: false,
  customerPresent: false,
  customerNumberPresent: false,
} as const;

export type SanitizedBrowserCallFixture = typeof sanitizedBrowserCallFixture;

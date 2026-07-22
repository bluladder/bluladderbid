// Offline OpenAI-compatible request fixtures for the voice adapter.
// No real PII. Ben's cell is intentionally absent from conversation content.

export const basicGreetingRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Hi there." },
  ],
};

export const serviceQuestionRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Do you clean gutters?" },
  ],
};

export const quoteRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "assistant", content: "How can I help you today?" },
    { role: "user", content: "I'd like a quote for my house wash." },
  ],
};

export const availabilityRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "What times do you have open next week?" },
  ],
};

export const bookingRequestDryRun = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "assistant", content: "I can offer Tuesday at 9am." },
    { role: "user", content: "Yes, book that appointment." },
  ],
};

export const humanTransferRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Can I speak to a human, please?" },
  ],
};

export const callbackRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Please have someone call me back later." },
  ],
};

export const uncertainPricingRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "How much for cleaning a commercial 4-story building?" },
  ],
};

export const uncertainSchedulingRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Can you come out later tonight?" },
  ],
};

export const gracefulEndingRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Thanks, that's all for now. Goodbye." },
  ],
};

export const postCallSmsHandoffRequest = {
  model: "bluladder-voice-adapter",
  stream: false,
  messages: [
    { role: "user", content: "Can you text me the details after we hang up?" },
  ],
};

export const streamingRequest = {
  model: "bluladder-voice-adapter",
  stream: true,
  messages: [
    { role: "user", content: "Tell me about your services." },
  ],
};

export const malformedRequestJson = "{ not really json ";
export const oversizedRequestBody = (() => {
  const filler = "x".repeat(64 * 1024);
  return JSON.stringify({ model: "m", stream: false, messages: [{ role: "user", content: filler }] });
})();
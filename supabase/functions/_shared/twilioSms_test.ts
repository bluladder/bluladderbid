import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  KLAMATH_TWILIO_CREDENTIAL_REFERENCE,
  resolveTwilioSmsConfig,
  sendTwilioSms,
  type TwilioSmsConfig,
} from "./twilioSms.ts";

const accountSid = `AC${"1".repeat(32)}`;
const apiKeySid = `SK${"4".repeat(32)}`;
const messagingServiceSid = `MG${"2".repeat(32)}`;
const messageSid = `SM${"3".repeat(32)}`;
const config: TwilioSmsConfig = {
  accountSid,
  apiKeySid,
  apiKeySecret: "test-key-secret",
  messagingServiceSid,
};

Deno.test("Twilio config resolves only the reviewed connector reference", () => {
  const priorSid = Deno.env.get("TWILIO_KLAMATH_ACCOUNT_SID");
  const priorKeySid = Deno.env.get("TWILIO_KLAMATH_API_KEY_SID");
  const priorKeySecret = Deno.env.get("TWILIO_KLAMATH_API_KEY_SECRET");
  try {
    Deno.env.set("TWILIO_KLAMATH_ACCOUNT_SID", accountSid);
    Deno.env.set("TWILIO_KLAMATH_API_KEY_SID", apiKeySid);
    Deno.env.set("TWILIO_KLAMATH_API_KEY_SECRET", "test-key-secret");
    assertEquals(
      resolveTwilioSmsConfig(
        KLAMATH_TWILIO_CREDENTIAL_REFERENCE,
        messagingServiceSid,
      ),
      config,
    );
    assertEquals(
      resolveTwilioSmsConfig("unreviewed-reference", messagingServiceSid),
      null,
    );
    assertEquals(
      resolveTwilioSmsConfig(
        KLAMATH_TWILIO_CREDENTIAL_REFERENCE,
        "PN-not-a-messaging-service",
      ),
      null,
    );
  } finally {
    if (priorSid === undefined) Deno.env.delete("TWILIO_KLAMATH_ACCOUNT_SID");
    else Deno.env.set("TWILIO_KLAMATH_ACCOUNT_SID", priorSid);
    if (priorKeySid === undefined) {
      Deno.env.delete("TWILIO_KLAMATH_API_KEY_SID");
    } else Deno.env.set("TWILIO_KLAMATH_API_KEY_SID", priorKeySid);
    if (priorKeySecret === undefined) {
      Deno.env.delete("TWILIO_KLAMATH_API_KEY_SECRET");
    } else {
      Deno.env.set("TWILIO_KLAMATH_API_KEY_SECRET", priorKeySecret);
    }
  }
});

Deno.test("Twilio send uses a Messaging Service and sanitized SMS body", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await sendTwilioSms(
    config,
    "(555) 123-4567",
    "**Your link** [Open](https://example.test)",
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ sid: messageSid, status: "queued" }),
        { status: 201 },
      );
    },
  );

  assertEquals(result.ok, true);
  assertEquals(result.messageId, messageSid);
  assertEquals(result.providerMessageStatus, "queued");
  assert(capturedUrl.endsWith(`/Accounts/${accountSid}/Messages.json`));
  const form = new URLSearchParams(String(capturedInit?.body));
  assertEquals(form.get("To"), "+15551234567");
  assertEquals(form.get("MessagingServiceSid"), messagingServiceSid);
  assertEquals(form.get("Body"), "Your link Open (https://example.test)");
  assertEquals(
    new Headers(capturedInit?.headers).get("Content-Type"),
    "application/x-www-form-urlencoded",
  );
  assert(new Headers(capturedInit?.headers).has("Authorization"));
  assertEquals(
    new Headers(capturedInit?.headers).get("Authorization"),
    `Basic ${btoa(`${apiKeySid}:test-key-secret`)}`,
  );
});

Deno.test("Twilio HTTP rejection is sanitized and terminal", async () => {
  const result = await sendTwilioSms(
    config,
    "+15551234567",
    "hello",
    async () =>
      new Response(
        JSON.stringify({ message: "response could contain private data" }),
        { status: 400 },
      ),
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "twilio_http_400");
  assertEquals(result.providerResponseKind, "http_rejection");
  assert(!JSON.stringify(result).includes("private data"));
});

Deno.test("Twilio malformed success is delivery-ambiguous", async () => {
  const result = await sendTwilioSms(
    config,
    "+15551234567",
    "hello",
    async () => new Response("not-json", { status: 201 }),
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "twilio_response_unreadable");
  assertEquals(result.providerResponseKind, "provider_ambiguous");
});

Deno.test("Twilio transport failure is delivery-ambiguous", async () => {
  const result = await sendTwilioSms(
    config,
    "+15551234567",
    "hello",
    () => Promise.reject(new Error("network details must stay private")),
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "twilio_transport_uncertain");
  assertEquals(result.providerResponseKind, "transport_uncertain");
});

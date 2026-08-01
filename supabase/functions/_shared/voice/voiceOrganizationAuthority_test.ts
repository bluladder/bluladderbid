import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractVoiceOrganizationSelectors } from "./voiceOrganizationAuthority.ts";

Deno.test("voice authority extracts a mapped Vapi assistant from every approved payload path", () => {
  for (
    const rawBody of [
      { assistant: { id: "assistant-a" } },
      { assistantId: "assistant-a" },
      { call: { assistantId: "assistant-a" } },
    ]
  ) {
    assertEquals(extractVoiceOrganizationSelectors(rawBody), [{
      source: "provider",
      keyType: "vapi_assistant",
      value: "assistant-a",
    }]);
  }
});

Deno.test("voice authority extracts a mapped Vapi phone resource from every approved payload path", () => {
  for (
    const rawBody of [
      { phoneNumber: { id: "phone-number-a" } },
      { phoneNumberId: "phone-number-a" },
      { call: { phoneNumber: { id: "phone-number-a" } } },
      { call: { phoneNumberId: "phone-number-a" } },
    ]
  ) {
    assertEquals(extractVoiceOrganizationSelectors(rawBody), [{
      source: "provider",
      keyType: "vapi_phone_number",
      value: "phone-number-a",
    }]);
  }
});

Deno.test("voice authority extracts both approved Vapi resource identifiers", () => {
  assertEquals(
    extractVoiceOrganizationSelectors({
      assistant: { id: "assistant-a" },
      call: {
        phoneNumberId: "phone-number-a",
        customer: { number: "+14695550123" },
      },
    }),
    [
      {
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-a",
      },
      {
        source: "provider",
        keyType: "vapi_phone_number",
        value: "phone-number-a",
      },
    ],
  );
});

Deno.test("duplicate Vapi payload paths are trimmed and collapse to one selector", () => {
  assertEquals(
    extractVoiceOrganizationSelectors({
      assistant: { id: "  assistant-a  " },
      assistantId: "assistant-a",
      call: {
        assistantId: "\tassistant-a",
        phoneNumber: { id: " phone-number-a " },
        phoneNumberId: "phone-number-a",
      },
      phoneNumberId: "phone-number-a ",
    }),
    [
      {
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-a",
      },
      {
        source: "provider",
        keyType: "vapi_phone_number",
        value: "phone-number-a",
      },
    ],
  );
});

Deno.test("distinct identifiers in duplicate payload paths are all preserved for conflict checks", () => {
  assertEquals(
    extractVoiceOrganizationSelectors({
      assistant: { id: "assistant-a" },
      assistantId: "assistant-b",
      phoneNumber: { id: "phone-number-a" },
      call: { phoneNumberId: "phone-number-b" },
    }),
    [
      {
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-a",
      },
      {
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-b",
      },
      {
        source: "provider",
        keyType: "vapi_phone_number",
        value: "phone-number-a",
      },
      {
        source: "provider",
        keyType: "vapi_phone_number",
        value: "phone-number-b",
      },
    ],
  );
});

Deno.test("ANI, email, and editable organization metadata are never authority selectors", () => {
  assertEquals(
    extractVoiceOrganizationSelectors({
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "caller@example.com",
      metadata: {
        organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        callerId: "+14695550123",
        email: "metadata@example.com",
        assistantId: "metadata-assistant",
        phoneNumberId: "metadata-phone-number",
      },
      customer: {
        number: "+14695550123",
        email: "customer@example.com",
      },
      call: {
        from: "+14695550123",
        customer: {
          number: "+14695550123",
          email: "call-customer@example.com",
        },
      },
    }),
    [],
  );
});

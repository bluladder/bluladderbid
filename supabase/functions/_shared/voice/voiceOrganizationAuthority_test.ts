import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractVoiceOrganizationSelectors } from "./voiceOrganizationAuthority.ts";

Deno.test("voice authority extracts only mapped Vapi resource identifiers", () => {
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

Deno.test("caller ID and arbitrary organization metadata are never authority selectors", () => {
  assertEquals(
    extractVoiceOrganizationSelectors({
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      metadata: {
        organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        callerId: "+14695550123",
        assistantId: "metadata-assistant",
        phoneNumberId: "metadata-phone-number",
      },
      customer: { number: "+14695550123" },
    }),
    [],
  );
});

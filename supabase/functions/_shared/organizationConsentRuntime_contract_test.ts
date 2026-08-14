import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

async function text(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, import.meta.url));
}

Deno.test("tenant-capable consent callers use organization-scoped RPCs", async () => {
  const queue = await text("../process-sms-queue/index.ts");
  const staffReply = await text("../staff-reply/index.ts");
  const aiChat = await text("../ai-chat/index.ts");
  const aiTools = await text("./aiTools.ts");

  assertStringIncludes(queue, "organizationConsentAllows");
  assertStringIncludes(queue, "msg.organization_id");
  assertStringIncludes(staffReply, "recordOrganizationConsent");
  assertStringIncludes(staffReply, "convo.organization_id");
  assertStringIncludes(aiChat, "resolvePortalOrganizationAuthority");
  assertStringIncludes(aiChat, "recordOrganizationConsent");
  assertStringIncludes(aiChat, '.eq("organization_id", organizationId)');
  assertStringIncludes(aiTools, "recordOrganizationConsent");

  for (const source of [queue, staffReply, aiChat, aiTools]) {
    assertEquals(source.includes('.rpc("record_consent"'), false);
    assertEquals(source.includes('.rpc("consent_allows"'), false);
  }
});

Deno.test("unreviewed Klamath chat and staff providers fail closed", async () => {
  const staffReply = await text("../staff-reply/index.ts");
  const aiChat = await text("../ai-chat/index.ts");

  assertStringIncludes(staffReply, "tenant_channel_unavailable");
  assertStringIncludes(staffReply, "organizationId !== DFW_ORGANIZATION_ID");
  assertStringIncludes(aiChat, "organizationId !== DFW_ORGANIZATION_ID");
  assertStringIncludes(
    aiChat,
    "Chat is not enabled for this organization yet.",
  );
});

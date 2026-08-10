import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAlertMessage,
  loadEnabledEscalationRecipients,
  resolveEscalationOrganizationId,
  SEVERITY_RANK,
} from "./escalation.ts";

const ORG = "00000000-0000-4000-8000-000000000091";
const OTHER_ORG = "00000000-0000-4000-8000-000000000092";

Deno.test("alert message includes safe fields only", () => {
  const msg = buildAlertMessage(
    {
      category: "complaint",
      severity: "high",
      prospectName: "Sam",
      prospectPhone: "+14690000000",
      summary: "Unhappy with streaks",
    },
    "(469) 747-2877",
    "Open the dashboard.",
  );
  assertEquals(msg.includes("BluLadder AI escalation"), true);
  assertEquals(msg.includes("Sam"), true);
  assertEquals(msg.includes("+14690000000"), true);
  assertEquals(msg.includes("complaint"), true);
  // Must never leak keys/prompts/transcripts.
  assertEquals(/api|prompt|transcript|margin/i.test(msg), false);
});

Deno.test("severity ranking supports one higher-severity re-alert", () => {
  assertEquals(SEVERITY_RANK.urgent > SEVERITY_RANK.normal, true);
  assertEquals(SEVERITY_RANK.high > SEVERITY_RANK.low, true);
});

Deno.test("escalation recipient authority is derived from the durable conversation", async () => {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select() {
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: { organization_id: ORG },
        error: null,
      });
    },
  };
  const supabase = {
    from(table: string) {
      assertEquals(table, "chat_conversations");
      return builder;
    },
  };
  assertEquals(
    await resolveEscalationOrganizationId(supabase, {
      conversationId: "conversation-1",
      organizationId: ORG,
    }),
    ORG,
  );
  assertEquals(
    await resolveEscalationOrganizationId(supabase, {
      conversationId: "conversation-1",
      organizationId: OTHER_ORG,
    }),
    null,
  );
  assertEquals(filters, [
    ["id", "conversation-1"],
    ["id", "conversation-1"],
  ]);
});

Deno.test("enabled escalation recipients are selected only inside one organization", async () => {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select() {
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: [{ id: "dfw-operator" }], error: null })
        .then(resolve);
    },
  };
  const rows = await loadEnabledEscalationRecipients({
    from(table: string) {
      assertEquals(table, "escalation_recipients");
      return builder;
    },
  }, ORG);
  assertEquals(rows, [{ id: "dfw-operator" }]);
  assertEquals(filters, [
    ["organization_id", ORG],
    ["is_enabled", true],
  ]);
});

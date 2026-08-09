import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { QuoteSession } from "../quoteSession.ts";
import {
  buildQuoteSessionConversationProjection,
  projectQuoteSessionToConversation,
  quoteSessionConversationLineageConflict,
} from "./quoteSessionProjection.ts";

function session(): QuoteSession {
  return {
    id: "00000000-0000-4000-8000-000000000075",
    organizationId: "00000000-0000-4000-8000-000000000072",
    channel: "voice",
    conversationIds: ["00000000-0000-4000-8000-000000000074"],
    fields: {
      services: ["windowCleaning"],
      name: "Synthetic Caller",
      email: "synthetic@example.com",
      phone: "+14695550172",
      address: "5612 Binbranch Lane, McKinney, TX 75071",
      serviceAreaStatus: "eligible",
      serviceAreaResult: {
        status: "eligible",
        formattedAddress: "5612 Binbranch Lane, McKinney, TX 75071",
      },
      callerIdConfirmationStatus: "contact_confirmed",
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        estimatedTotal: 216.5,
        inputsKey: "fresh-key",
      },
    },
    fieldStatus: {
      name: "verified",
      email: "verified",
      phone: "captured",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    requiredRemaining: [],
    quoteStatus: "firm",
    bookingReady: true,
    lastStep: "priced_spoken",
  };
}

Deno.test("projection publishes confirmed form values and canonical quote", () => {
  const patch = buildQuoteSessionConversationProjection({
    session: session(),
    conversation: {
      id: "00000000-0000-4000-8000-000000000074",
      organization_id: "00000000-0000-4000-8000-000000000072",
    },
    now: "2026-08-01T00:00:00.000Z",
  });
  assertEquals(patch.prospect_name, "Synthetic Caller");
  assertEquals(patch.prospect_email, "synthetic@example.com");
  assertEquals(
    patch.service_address,
    "5612 Binbranch Lane, McKinney, TX 75071",
  );
  assertEquals(patch.service_area_status, "eligible");
  assertEquals(patch.booking_status, "quoted");
  assertObjectMatch(patch.facts as Record<string, unknown>, {
    address: "5612 Binbranch Lane, McKinney, TX 75071",
    bookingStatus: "quoted",
  });
});

Deno.test("projection never overwrites verified data with a defaulted answer", () => {
  const lower = session();
  lower.fields.email = "lower@example.com";
  lower.fields.squareFootage = 1500;
  lower.fieldStatus.email = "defaulted";
  lower.fieldStatus.squareFootage = "defaulted";
  const patch = buildQuoteSessionConversationProjection({
    session: lower,
    conversation: {
      id: "c",
      organization_id: lower.organizationId!,
      prospect_email: "verified@example.com",
      facts: {
        property: { squareFootage: 2500 },
        canonicalProjection: {
          version: "quote-session-projection-v1",
          sessionId: lower.id,
          fieldStatus: { email: "verified", squareFootage: "verified" },
          projectedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    },
  });
  assertEquals(patch.prospect_email, undefined);
  assertEquals(
    (patch.facts as { property: { squareFootage: number } }).property
      .squareFootage,
    2500,
  );
});

Deno.test("explicit correction may replace a prior verified value", () => {
  const corrected = session();
  corrected.fields.email = "corrected@example.com";
  corrected.fieldStatus.email = "corrected";
  const patch = buildQuoteSessionConversationProjection({
    session: corrected,
    conversation: {
      id: "c",
      organization_id: corrected.organizationId!,
      prospect_email: "old@example.com",
      facts: {
        canonicalProjection: {
          version: "quote-session-projection-v1",
          sessionId: corrected.id,
          fieldStatus: { email: "verified" },
          projectedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    },
  });
  assertEquals(patch.prospect_email, "corrected@example.com");
});

Deno.test("projection rejects conflicting customer or property lineage", () => {
  const linked = session();
  linked.conversationIds = ["c"];
  linked.customerId = "customer-session";
  linked.propertyId = "property-session";
  assertEquals(
    quoteSessionConversationLineageConflict(linked, {
      id: "c",
      organization_id: linked.organizationId!,
      customer_id: "customer-other",
      property_id: "property-session",
    }),
    "customer_lineage_conflict",
  );
  assertEquals(
    quoteSessionConversationLineageConflict(linked, {
      id: "c",
      organization_id: linked.organizationId!,
      customer_id: "customer-session",
      property_id: "property-other",
    }),
    "property_lineage_conflict",
  );
});

Deno.test("projection rejects a conversation outside the quote-session lineage", () => {
  assertEquals(
    quoteSessionConversationLineageConflict(session(), {
      id: "conversation-other",
      organization_id: session().organizationId!,
    }),
    "conversation_lineage_conflict",
  );
});

Deno.test("engine firmness never overrides a manual-review disposition", () => {
  const manual = session();
  manual.lastStep = "manual_review_required";
  manual.quoteStatus = "manual_review";
  manual.fields.lastQuoteResult = {
    ...manual.fields.lastQuoteResult,
    status: "firm",
    finalQuoteDisposition: "manual_review",
  };
  const patch = buildQuoteSessionConversationProjection({
    session: manual,
    conversation: { id: "c", organization_id: manual.organizationId! },
  });
  assertEquals(
    (patch.facts as { quote: { firm: boolean } }).quote.firm,
    false,
  );
});

Deno.test("projection reuses the exact persisted session winner without rereading it", async () => {
  let quoteSessionReads = 0;
  const committed = session();
  const conversation = {
    id: committed.conversationIds[0],
    organization_id: committed.organizationId,
    updated_at: "2026-08-08T00:00:00.000Z",
    quote_session_id: committed.id,
  };
  const chain = (result: Record<string, unknown>) => {
    const query = {
      eq: () => query,
      select: () => query,
      maybeSingle: () => Promise.resolve(result),
    };
    return query;
  };
  const supabase = {
    from(table: string) {
      if (table === "quote_sessions") {
        quoteSessionReads += 1;
        throw new Error("preloaded_session_must_avoid_read");
      }
      return {
        select: () => chain({ data: conversation, error: null }),
        update: () => chain({ data: { id: conversation.id }, error: null }),
      };
    },
  };
  const result = await projectQuoteSessionToConversation(supabase, {
    sessionId: committed.id,
    conversationId: conversation.id,
    organizationId: committed.organizationId!,
    session: committed,
  });
  assertEquals(result.status, "projected");
  assertEquals(quoteSessionReads, 0);
});

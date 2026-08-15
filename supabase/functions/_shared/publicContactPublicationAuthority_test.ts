import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePublishedPublicContacts } from "./publicContactPublicationAuthority.ts";

const organizationId = "b1addf00-0000-4000-8000-000000000003";
const approvalHash = "a".repeat(64);
const base = {
  organization_id: organizationId,
  status: "published",
  owner_approved_at: "2026-08-15T00:00:00.000Z",
  owner_approval_reference_hash: approvalHash,
  verified_at: "2026-08-15T00:01:00.000Z",
  published_at: "2026-08-15T00:02:00.000Z",
  configuration_version: 1,
};

function fake(data: unknown[], error: unknown = null) {
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  return {
    reads,
    client: {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        return {
          select() {
            return this;
          },
          eq(field: string, value: unknown) {
            filters[field] = value;
            return this;
          },
          limit() {
            reads.push({ table, filters });
            return Promise.resolve({ data, error });
          },
        };
      },
    },
  };
}

Deno.test("public contacts resolve reviewed phone and email without provenance", async () => {
  const provider = fake([
    {
      ...base,
      channel: "email",
      label: "Email support",
      destination: "support@example.com",
    },
    {
      ...base,
      channel: "phone",
      label: "Call support",
      destination: "+15415550100",
    },
  ]);
  assertEquals(
    await resolvePublishedPublicContacts(provider.client, organizationId),
    {
      status: "resolved",
      contacts: [
        { channel: "phone", label: "Call support", value: "+15415550100" },
        {
          channel: "email",
          label: "Email support",
          value: "support@example.com",
        },
      ],
    },
  );
  assertEquals(provider.reads, [{
    table: "organization_public_contacts",
    filters: { organization_id: organizationId, status: "published" },
  }]);
});

Deno.test("public contacts fail closed when missing or unavailable", async () => {
  assertEquals(
    await resolvePublishedPublicContacts(fake([]).client, organizationId),
    {
      status: "blocked",
      code: "contact_missing",
    },
  );
  assertEquals(
    await resolvePublishedPublicContacts(
      fake([], { message: "missing" }).client,
      organizationId,
    ),
    { status: "blocked", code: "contact_unavailable" },
  );
  assertEquals(
    await resolvePublishedPublicContacts(fake([]).client, "not-an-id"),
    {
      status: "blocked",
      code: "invalid_organization",
    },
  );
});

Deno.test("public contacts reject duplicate channels and cross-organization rows", async () => {
  const phone = {
    ...base,
    channel: "phone",
    label: "Call support",
    destination: "+15415550100",
  };
  assertEquals(
    await resolvePublishedPublicContacts(
      fake([phone, { ...phone, destination: "+15415550101" }]).client,
      organizationId,
    ),
    { status: "blocked", code: "contact_ambiguous" },
  );
  assertEquals(
    await resolvePublishedPublicContacts(
      fake([{
        ...phone,
        organization_id: "b1addf00-0000-4000-8000-000000000001",
      }]).client,
      organizationId,
    ),
    { status: "blocked", code: "contact_invalid" },
  );
});

Deno.test("public contacts reject draft, malformed, unverified, and unapproved rows", async () => {
  const valid = {
    ...base,
    channel: "email",
    label: "Email support",
    destination: "support@example.com",
  };
  for (
    const row of [
      { ...valid, status: "draft" },
      { ...valid, destination: "UPPER@example.com" },
      { ...valid, verified_at: null },
      { ...valid, owner_approval_reference_hash: "not-a-hash" },
      { ...valid, published_at: "2026-08-14T23:00:00.000Z" },
      { ...valid, label: "  Email support  " },
    ]
  ) {
    assertEquals(
      await resolvePublishedPublicContacts(fake([row]).client, organizationId),
      { status: "blocked", code: "contact_invalid" },
    );
  }
});

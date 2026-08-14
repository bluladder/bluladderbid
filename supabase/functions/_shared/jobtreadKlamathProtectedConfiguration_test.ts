import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createKlamathJobTreadProtectedResolvers,
  KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS,
  KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
  KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE,
  KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT,
  KLAMATH_JOBTREAD_ENVIRONMENT_KEYS,
  KLAMATH_JOBTREAD_ORGANIZATION_ID,
} from "./jobtreadKlamathProtectedConfiguration.ts";

const values = () =>
  new Map<string, string>([
    [KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.grantKey, "grant_key_test_1234567890"],
    [
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.providerOrganizationId,
      "provider_org_test",
    ],
    [
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.customerReferenceFieldId,
      "field_customer_reference",
    ],
    [KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactPhoneFieldId, "field_phone"],
    [KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactEmailFieldId, "field_email"],
    [
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.locationReferenceFieldId,
      "field_location_reference",
    ],
    [
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.bookingReferenceFieldId,
      "field_booking_reference",
    ],
  ]);

Deno.test("Klamath JobTread protected resolvers expose exact non-secret configuration", async () => {
  const environment = values();
  const resolvers = createKlamathJobTreadProtectedResolvers((key) =>
    environment.get(key)
  );
  const read = await resolvers.readConfiguration.resolve({
    organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
  });
  const write = await resolvers.writeConfiguration.resolve({
    organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
  });
  if (!read || !write) throw new Error("protected_configuration_missing");
  assertEquals(read, {
    organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
    providerOrganizationId: "provider_org_test",
    allowedServiceKeys: [...KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS],
    configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
  });
  assertEquals(write, {
    ...read,
    bindings: {
      customerReferenceFieldId: "field_customer_reference",
      contactPhoneFieldId: "field_phone",
      contactEmailFieldId: "field_email",
      locationReferenceFieldId: "field_location_reference",
      bookingReferenceFieldId: "field_booking_reference",
    },
  });
  assertFalse(JSON.stringify({ read, write }).includes("grant_key_test"));
  assertEquals(
    await resolvers.credentials.resolve(KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE),
    "grant_key_test_1234567890",
  );
  assertMatch(
    (await resolvers.providerOrganizationFingerprint()) ?? "",
    /^[0-9a-f]{64}$/,
  );
});

Deno.test("Klamath JobTread resolvers fail closed for another organization or reference", async () => {
  const environment = values();
  const resolvers = createKlamathJobTreadProtectedResolvers((key) =>
    environment.get(key)
  );
  assertEquals(
    await resolvers.readConfiguration.resolve({
      organizationId: "b1addf00-0000-4000-8000-000000000001",
    }),
    null,
  );
  assertEquals(
    await resolvers.writeConfiguration.resolve({
      organizationId: "b1addf00-0000-4000-8000-000000000001",
    }),
    null,
  );
  assertEquals(await resolvers.credentials.resolve("unknown"), null);
});

Deno.test("Klamath JobTread resolvers reject missing, duplicate, or malformed authority", async () => {
  for (
    const key of Object.values(KLAMATH_JOBTREAD_ENVIRONMENT_KEYS).filter(
      (key) => key !== KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.grantKey,
    )
  ) {
    const environment = values();
    environment.delete(key);
    const resolvers = createKlamathJobTreadProtectedResolvers((name) =>
      environment.get(name)
    );
    assertEquals(
      await resolvers.writeConfiguration.resolve({
        organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
      }),
      null,
    );
  }

  const duplicate = values();
  duplicate.set(
    KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactEmailFieldId,
    duplicate.get(KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactPhoneFieldId)!,
  );
  assertEquals(
    await createKlamathJobTreadProtectedResolvers((key) => duplicate.get(key))
      .writeConfiguration.resolve({
        organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
      }),
    null,
  );

  const malformed = values();
  malformed.set(
    KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.providerOrganizationId,
    "contains spaces",
  );
  assertEquals(
    await createKlamathJobTreadProtectedResolvers((key) => malformed.get(key))
      .providerOrganizationFingerprint(),
    null,
  );
  malformed.set(
    KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.providerOrganizationId,
    " provider_org_test ",
  );
  assertEquals(
    await createKlamathJobTreadProtectedResolvers((key) => malformed.get(key))
      .readConfiguration.resolve({
        organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
      }),
    null,
  );
});

Deno.test("Klamath JobTread credential resolver preserves exact secret and rejects unsafe forms", async () => {
  const environment = values();
  const resolvers = createKlamathJobTreadProtectedResolvers((key) =>
    environment.get(key)
  );
  environment.set(KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.grantKey, " short ");
  assertEquals(
    await resolvers.credentials.resolve(KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE),
    null,
  );
  environment.set(
    KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.grantKey,
    "valid_prefix\ninvalid_suffix",
  );
  assertEquals(
    await resolvers.credentials.resolve(KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE),
    null,
  );
});

Deno.test("Klamath JobTread custom-field contract is exact and non-sensitive", () => {
  assertEquals(KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT.customerReference, {
    entity: "customer_account",
    name: "BluLadder Customer Reference",
    type: "text",
    multiple: false,
    required: false,
  });
  assertEquals(
    KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT.locationReference.name,
    "BluLadder Location Reference",
  );
  assertEquals(
    KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT.bookingReference.name,
    "BluLadder Booking Reference",
  );
  assert(
    KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT.contactPhone.existingProviderField,
  );
  assert(
    KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT.contactEmail.existingProviderField,
  );
  assertFalse(
    JSON.stringify(KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT).toLowerCase()
      .includes("grant"),
  );
});

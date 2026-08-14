import type {
  JobTreadProtectedCredentialResolver,
} from "./jobtreadExecutionRunner.ts";
import type {
  JobTreadProtectedReadConfigurationResolver,
} from "./jobtreadReadPlanSource.ts";
import type {
  JobTreadProtectedWriteConfigurationResolver,
} from "./jobtreadWritePlanSource.ts";

export const KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE =
  "bluladder-klamath-jobtread-production-v1";
export const KLAMATH_JOBTREAD_CONFIGURATION_VERSION = 1;
export const KLAMATH_JOBTREAD_ORGANIZATION_ID =
  "b1addf00-0000-4000-8000-000000000003";

export const KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS = [
  "window_cleaning",
  "gutter_cleaning",
  "house_wash",
  "pressure_washing",
] as const;

export const KLAMATH_JOBTREAD_ENVIRONMENT_KEYS = Object.freeze({
  grantKey: "JOBTREAD_KLAMATH_GRANT_KEY",
  providerOrganizationId: "JOBTREAD_KLAMATH_PROVIDER_ORGANIZATION_ID",
  customerReferenceFieldId: "JOBTREAD_KLAMATH_CUSTOMER_REFERENCE_FIELD_ID",
  contactPhoneFieldId: "JOBTREAD_KLAMATH_CONTACT_PHONE_FIELD_ID",
  contactEmailFieldId: "JOBTREAD_KLAMATH_CONTACT_EMAIL_FIELD_ID",
  locationReferenceFieldId: "JOBTREAD_KLAMATH_LOCATION_REFERENCE_FIELD_ID",
  bookingReferenceFieldId: "JOBTREAD_KLAMATH_BOOKING_REFERENCE_FIELD_ID",
});

export const KLAMATH_JOBTREAD_CUSTOM_FIELD_CONTRACT = Object.freeze({
  customerReference: {
    entity: "customer_account",
    name: "BluLadder Customer Reference",
    type: "text",
    multiple: false,
    required: false,
  },
  contactPhone: {
    entity: "customer_contact",
    name: "Phone",
    type: "phone_number",
    existingProviderField: true,
  },
  contactEmail: {
    entity: "customer_contact",
    name: "Email",
    type: "email_address",
    existingProviderField: true,
  },
  locationReference: {
    entity: "location",
    name: "BluLadder Location Reference",
    type: "text",
    multiple: false,
    required: false,
  },
  bookingReference: {
    entity: "job",
    name: "BluLadder Booking Reference",
    type: "text",
    multiple: false,
    required: false,
  },
});

export type JobTreadEnvironmentReader = (key: string) => string | undefined;

export interface KlamathJobTreadProtectedResolvers {
  readConfiguration: JobTreadProtectedReadConfigurationResolver;
  writeConfiguration: JobTreadProtectedWriteConfigurationResolver;
  credentials: JobTreadProtectedCredentialResolver;
  providerOrganizationFingerprint(): Promise<string | null>;
}

const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function defaultEnvironmentReader(key: string): string | undefined {
  return Deno.env.get(key);
}

function providerReference(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized === value && PROVIDER_REFERENCE_PATTERN.test(normalized)
    ? normalized
    : null;
}

function grantKey(value: string | undefined): string | null {
  if (
    !value || value.length < 16 || value.length > 4096 ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return /\s/.test(character) || code < 32 || code === 127;
    })
  ) {
    return null;
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function resolveAuthority(readEnvironment: JobTreadEnvironmentReader): {
  providerOrganizationId: string;
  bindings: {
    customerReferenceFieldId: string;
    contactPhoneFieldId: string;
    contactEmailFieldId: string;
    locationReferenceFieldId: string;
    bookingReferenceFieldId: string;
  };
} | null {
  const providerOrganizationId = providerReference(
    readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.providerOrganizationId,
    ),
  );
  const bindings = {
    customerReferenceFieldId: providerReference(readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.customerReferenceFieldId,
    )),
    contactPhoneFieldId: providerReference(readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactPhoneFieldId,
    )),
    contactEmailFieldId: providerReference(readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.contactEmailFieldId,
    )),
    locationReferenceFieldId: providerReference(readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.locationReferenceFieldId,
    )),
    bookingReferenceFieldId: providerReference(readEnvironment(
      KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.bookingReferenceFieldId,
    )),
  };
  if (
    !providerOrganizationId || Object.values(bindings).some((value) => !value)
  ) {
    return null;
  }
  const normalizedBindings = bindings as Record<keyof typeof bindings, string>;
  if (new Set(Object.values(normalizedBindings)).size !== 5) return null;
  return { providerOrganizationId, bindings: normalizedBindings };
}

/**
 * Concrete Klamath-only protected resolvers. Raw provider identifiers and the
 * one-time Grant Key are accepted only from server-side environment storage.
 * Nothing in this module enables runtime or provider traffic.
 */
export function createKlamathJobTreadProtectedResolvers(
  readEnvironment: JobTreadEnvironmentReader = defaultEnvironmentReader,
): KlamathJobTreadProtectedResolvers {
  return {
    readConfiguration: {
      resolve({ organizationId }) {
        if (organizationId !== KLAMATH_JOBTREAD_ORGANIZATION_ID) {
          return Promise.resolve(null);
        }
        const authority = resolveAuthority(readEnvironment);
        if (!authority) return Promise.resolve(null);
        return Promise.resolve({
          organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
          providerOrganizationId: authority.providerOrganizationId,
          allowedServiceKeys: [...KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS],
          configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
        });
      },
    },
    writeConfiguration: {
      resolve({ organizationId }) {
        if (organizationId !== KLAMATH_JOBTREAD_ORGANIZATION_ID) {
          return Promise.resolve(null);
        }
        const authority = resolveAuthority(readEnvironment);
        if (!authority) return Promise.resolve(null);
        return Promise.resolve({
          organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
          providerOrganizationId: authority.providerOrganizationId,
          allowedServiceKeys: [...KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS],
          configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
          bindings: authority.bindings,
        });
      },
    },
    credentials: {
      resolve(credentialReference) {
        if (credentialReference !== KLAMATH_JOBTREAD_CREDENTIAL_REFERENCE) {
          return Promise.resolve(null);
        }
        return Promise.resolve(
          grantKey(readEnvironment(KLAMATH_JOBTREAD_ENVIRONMENT_KEYS.grantKey)),
        );
      },
    },
    async providerOrganizationFingerprint() {
      const authority = resolveAuthority(readEnvironment);
      return authority
        ? await sha256Hex(authority.providerOrganizationId)
        : null;
    },
  };
}

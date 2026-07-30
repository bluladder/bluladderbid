import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EXPECTED_SURFACES = {
  publicBooking: {
    status: "verified",
    checks: {
      supabaseProjectMatches: true,
      serverGeocoderConfigured: true,
      browserKeyRestricted: true,
      organizationResolutionReady: true,
      jobberScheduleMirrorCurrent: true,
      publicBookingEnabled: false,
    },
  },
  jobber: {
    status: "verified",
    checks: {
      oauthAppIdentityConfirmed: true,
      expectedAccountIdentityConfirmed: true,
      requiredReadScopeConfirmed: true,
      requiredWriteScopesConfirmed: true,
      tokenMetadataCurrent: true,
      webhookAuthenticationConfigured: true,
      scheduleMirrorCurrent: true,
      apiVersionConfirmed: true,
    },
  },
  resend: {
    status: "verified",
    checks: {
      connectorIdentityConfirmed: true,
      expectedAccountIdentityConfirmed: true,
      sendingDomainVerified: true,
      senderAlignmentConfirmed: true,
      outboundWebhookConfigured: true,
      inboundDomainVerified: true,
      inboundWebhookConfigured: true,
    },
  },
  callrail: {
    status: "verified",
    checks: {
      accountCompanyIdentityConfirmed: true,
      apiKeyScopeConfirmed: true,
      approvedSenderMatched: true,
      senderTextEnabled: true,
      inboundWebhookConfigured: true,
      routingUnchanged: true,
    },
  },
  twilio: {
    status: "not_applicable",
    checks: {
      runtimeDependencyPresent: false,
      providerSelectionDecisionDocumented: true,
    },
  },
  vapi: {
    status: "verified",
    checks: {
      organizationIdentityConfirmed: true,
      zeroDataRetentionEnabled: true,
      hipaaModeDisabled: true,
      assistantMatchesManifest: true,
      endpointsTargetExpectedProject: true,
      webhookAuthenticationConfigured: true,
      customLlmCredentialAttached: true,
      serverEventCredentialAttached: true,
      isolatedDidAssigned: true,
      toolsEmpty: true,
      transferDisabled: true,
      artifactsDisabled: true,
      allowedEventsExact: true,
      callrailUnlinked: true,
    },
  },
  bidDelivery: {
    status: "verified",
    checks: {
      emailProviderIdentityConfirmed: true,
      smsProviderIdentityConfirmed: true,
      existingProviderIdsReconciled: true,
      suppressionsReviewed: true,
      uncertainClaimsReviewed: true,
      noSyntheticDeliveryPerformed: true,
    },
  },
};

const ALLOWED_STATUSES = new Set(["verified", "blocked", "not_applicable"]);
const MAX_RELEASE_EVIDENCE_AGE_MS = 2 * 60 * 60_000;
const FORBIDDEN_KEYS = new Set([
  "secret",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "authorizationheader",
  "credentialvalue",
  "password",
  "phonenumber",
  "emailaddress",
  "recipient",
  "customer",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function add(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isUtcIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function requireBoolean(errors, value, path, expected) {
  if (typeof value !== "boolean") {
    add(errors, path, "must be a boolean");
    return;
  }
  if (expected !== undefined && value !== expected) {
    add(errors, path, `must be ${expected}`);
  }
}

function scanForSensitiveMaterial(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForSensitiveMaterial(item, `${path}[${index}]`, errors)
    );
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        add(errors, `${path}.${key}`, "forbidden credential or PII field");
      }
      scanForSensitiveMaterial(item, `${path}.${key}`, errors);
    }
    return;
  }
  if (typeof value !== "string") return;

  if (/bearer\s+\S+/i.test(value)) {
    add(errors, path, "must not contain an authorization value");
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    add(errors, path, "must not contain a JWT-shaped value");
  }
  if (/^\+\d{10,15}$/.test(value)) {
    add(errors, path, "must not contain a full E.164 phone number");
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    add(errors, path, "must not contain an email address");
  }
  if (/^https?:\/\/[^/\s]+@/i.test(value) || /[?&](token|key|secret)=/i.test(value)) {
    add(errors, path, "must not contain URL credentials or secret query parameters");
  }
}

export function validateProviderVerification(record) {
  const errors = [];
  if (!isObject(record)) return ["root: must be a JSON object"];

  if (record.schemaVersion !== 1) {
    add(errors, "schemaVersion", "must equal 1");
  }
  if (typeof record.evidenceId !== "string" || !record.evidenceId.trim()) {
    add(errors, "evidenceId", "must be a non-empty string");
  }
  if (!isUtcIsoTimestamp(record.capturedAt)) {
    add(errors, "capturedAt", "must be a UTC ISO-8601 timestamp");
  }

  if (!isObject(record.authorization)) {
    add(errors, "authorization", "must be an object");
  } else {
    requireBoolean(errors, record.authorization.readOnly, "authorization.readOnly", true);
    requireBoolean(
      errors,
      record.authorization.providerMutationAllowed,
      "authorization.providerMutationAllowed",
      false,
    );
    requireBoolean(
      errors,
      record.authorization.credentialInspectionAllowed,
      "authorization.credentialInspectionAllowed",
      false,
    );
  }

  if (!isObject(record.redaction)) {
    add(errors, "redaction", "must be an object");
  } else {
    requireBoolean(
      errors,
      record.redaction.credentialValuesIncluded,
      "redaction.credentialValuesIncluded",
      false,
    );
    requireBoolean(
      errors,
      record.redaction.customerDataIncluded,
      "redaction.customerDataIncluded",
      false,
    );
    requireBoolean(
      errors,
      record.redaction.fullPhoneNumbersIncluded,
      "redaction.fullPhoneNumbersIncluded",
      false,
    );
    requireBoolean(
      errors,
      record.redaction.operatorAttestation,
      "redaction.operatorAttestation",
      true,
    );
  }

  if (!isObject(record.environment)) {
    add(errors, "environment", "must be an object");
  } else {
    if (!["production", "staging", "local"].includes(record.environment.name)) {
      add(errors, "environment.name", "must be production, staging, or local");
    }
    if (
      typeof record.environment.projectIdentity !== "string" ||
      !/^masked:[A-Za-z0-9._-]{4,32}$/.test(record.environment.projectIdentity)
    ) {
      add(
        errors,
        "environment.projectIdentity",
        "must be a masked identifier such as masked:project-1234",
      );
    }
    if (
      typeof record.environment.repositoryBuild !== "string" ||
      !/^sha256:[a-f0-9]{12}$/.test(record.environment.repositoryBuild)
    ) {
      add(
        errors,
        "environment.repositoryBuild",
        "must be a redacted 12-hex SHA marker such as sha256:0123456789ab",
      );
    }
  }
  if (!isObject(record.releaseBinding)) {
    add(errors, "releaseBinding", "must be an object");
  } else {
    if (
      typeof record.releaseBinding.projectRefSha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(
        record.releaseBinding.projectRefSha256,
      )
    ) {
      add(
        errors,
        "releaseBinding.projectRefSha256",
        "must be the SHA-256 binding for the exact project ref",
      );
    }
    if (
      typeof record.releaseBinding.repositorySha !== "string" ||
      !/^[a-f0-9]{40}$/.test(record.releaseBinding.repositorySha)
    ) {
      add(
        errors,
        "releaseBinding.repositorySha",
        "must be the full lowercase release commit SHA",
      );
    }
  }

  if (!isObject(record.surfaces)) {
    add(errors, "surfaces", "must be an object");
  } else {
    for (const [surfaceName, contract] of Object.entries(EXPECTED_SURFACES)) {
      const surface = record.surfaces[surfaceName];
      const path = `surfaces.${surfaceName}`;
      if (!isObject(surface)) {
        add(errors, path, "is required");
        continue;
      }
      if (!ALLOWED_STATUSES.has(surface.status)) {
        add(errors, `${path}.status`, "must be verified, blocked, or not_applicable");
      }
      if (surface.status === "not_applicable" && surfaceName !== "twilio") {
        add(errors, `${path}.status`, "not_applicable is allowed only for Twilio");
      }
      if (surfaceName === "twilio" && surface.status === "verified") {
        add(
          errors,
          `${path}.status`,
          "must remain not_applicable or blocked while no Twilio runtime exists",
        );
      }
      if (surface.status === "blocked") {
        if (!Array.isArray(surface.blockers) || surface.blockers.length === 0) {
          add(errors, `${path}.blockers`, "blocked surfaces require at least one blocker");
        } else if (
          surface.blockers.some((blocker) =>
            typeof blocker !== "string" || !blocker.trim()
          )
        ) {
          add(errors, `${path}.blockers`, "must contain non-empty sanitized strings");
        }
      } else if (surface.blockers !== undefined) {
        add(errors, `${path}.blockers`, "is allowed only when status is blocked");
      }
      if (!isObject(surface.checks)) {
        add(errors, `${path}.checks`, "must be an object");
        continue;
      }

      const requiredChecks = contract.checks;
      for (const [checkName, expectedValue] of Object.entries(requiredChecks)) {
        const expected =
          surface.status === contract.status ? expectedValue : undefined;
        requireBoolean(
          errors,
          surface.checks[checkName],
          `${path}.checks.${checkName}`,
          expected,
        );
      }
      for (const checkName of Object.keys(surface.checks)) {
        if (!(checkName in requiredChecks)) {
          add(errors, `${path}.checks.${checkName}`, "is not a recognized check");
        }
      }
    }
    for (const surfaceName of Object.keys(record.surfaces)) {
      if (!(surfaceName in EXPECTED_SURFACES)) {
        add(errors, `surfaces.${surfaceName}`, "is not a recognized surface");
      }
    }
  }

  scanForSensitiveMaterial(record, "root", errors);
  return [...new Set(errors)];
}

export function evaluateProviderVerification(
  record,
  {
    release = false,
    projectRef = null,
    repositorySha = null,
    now = new Date(),
  } = {},
) {
  const schemaErrors = validateProviderVerification(record);
  const releaseErrors = [];
  if (release) {
    if (!/^[a-z0-9]{20}$/.test(projectRef ?? "")) {
      add(
        releaseErrors,
        "expected.projectRef",
        "must be the exact 20-character hosted project ref",
      );
    }
    if (!/^[a-f0-9]{40}$/.test(repositorySha ?? "")) {
      add(
        releaseErrors,
        "expected.repositorySha",
        "must be the exact full lowercase release SHA",
      );
    }
    if (record.environment?.name !== "production") {
      add(
        releaseErrors,
        "environment.name",
        "must be production for release verification",
      );
    }
    if (
      projectRef &&
      record.releaseBinding?.projectRefSha256 !== `sha256:${sha256(projectRef)}`
    ) {
      add(
        releaseErrors,
        "releaseBinding.projectRefSha256",
        "does not match the expected hosted project",
      );
    }
    if (
      repositorySha &&
      record.releaseBinding?.repositorySha !== repositorySha
    ) {
      add(
        releaseErrors,
        "releaseBinding.repositorySha",
        "does not match the expected release commit",
      );
    }
    const capturedAt = Date.parse(record.capturedAt ?? "");
    if (
      !Number.isFinite(capturedAt) ||
      capturedAt > now.getTime() ||
      now.getTime() - capturedAt > MAX_RELEASE_EVIDENCE_AGE_MS
    ) {
      add(
        releaseErrors,
        "capturedAt",
        "must not be future-dated and must be no more than two hours old",
      );
    }
    for (const [surfaceName, contract] of Object.entries(EXPECTED_SURFACES)) {
      if (record.surfaces?.[surfaceName]?.status !== contract.status) {
        add(
          releaseErrors,
          `surfaces.${surfaceName}.status`,
          `must be ${contract.status} for release verification`,
        );
      }
    }
  }
  return {
    schemaValid: schemaErrors.length === 0,
    releaseVerified:
      release && schemaErrors.length === 0 && releaseErrors.length === 0,
    schemaErrors,
    releaseErrors: [...new Set(releaseErrors)],
  };
}

async function main() {
  const inputPath = process.argv
    .slice(2)
    .find((argument) => !argument.startsWith("--"));
  const jsonOutput = process.argv.includes("--json");
  const releaseMode = process.argv.includes("--release");
  const optionValue = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  if (!inputPath) {
    console.error(
      "Usage: node scripts/check-provider-config-contract.mjs " +
        "<sanitized-evidence.json> [--release --project-ref REF " +
        "--repository-sha SHA] [--json]",
    );
    process.exitCode = 2;
    return;
  }

  const record = JSON.parse(await readFile(inputPath, "utf8"));
  const evaluation = evaluateProviderVerification(record, {
    release: releaseMode,
    projectRef: optionValue("--project-ref"),
    repositorySha: optionValue("--repository-sha"),
  });
  const errors = [
    ...evaluation.schemaErrors,
    ...evaluation.releaseErrors,
  ];
  const result = {
    schemaValid: evaluation.schemaValid,
    releaseVerified: evaluation.releaseVerified,
    mode: releaseMode ? "release" : "schema",
    input: inputPath,
    errors,
  };

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (releaseMode && result.releaseVerified) {
    console.log(`Provider configuration RELEASE VERIFIED: ${inputPath}`);
  } else if (!releaseMode && result.schemaValid) {
    console.log(
      `Provider configuration schema valid (NOT release verified): ${inputPath}`,
    );
  } else {
    console.error(`Provider configuration evidence contract failed: ${inputPath}`);
    errors.forEach((error) => console.error(`- ${error}`));
  }

  if (
    (releaseMode && !result.releaseVerified) ||
    (!releaseMode && !result.schemaValid)
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

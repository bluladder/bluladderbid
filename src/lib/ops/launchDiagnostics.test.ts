import { describe, expect, it } from "vitest";
import { launchDiagnosticFixtures } from "./launchDiagnostics.fixtures";
import {
  canResolveLaunchDiagnostic,
  LAUNCH_DIAGNOSTIC_KINDS,
  resolveDiagnosticsMode,
  selectLaunchDiagnostics,
  unresolvedLaunchDiagnosticCount,
} from "./launchDiagnostics";

const allowed = {
  authenticated: true,
  adminAuthorized: true,
  organizationId: "00000000-0000-4000-8000-0000000000df",
};

describe("launch diagnostics contract", () => {
  it("covers every required launch workflow", () => {
    expect(new Set(launchDiagnosticFixtures.map((item) => item.kind))).toEqual(new Set(LAUNCH_DIAGNOSTIC_KINDS));
  });

  it("denies unauthenticated, unauthorized, organizationless, and cross-tenant reads", () => {
    expect(selectLaunchDiagnostics(launchDiagnosticFixtures, { ...allowed, authenticated: false })).toEqual([]);
    expect(selectLaunchDiagnostics(launchDiagnosticFixtures, { ...allowed, adminAuthorized: false })).toEqual([]);
    expect(selectLaunchDiagnostics(launchDiagnosticFixtures, { ...allowed, organizationId: null })).toEqual([]);
    expect(selectLaunchDiagnostics(launchDiagnosticFixtures, { ...allowed, organizationId: "other" })).toEqual([]);
  });

  it("filters retryable unresolved items and counts all unresolved items", () => {
    expect(selectLaunchDiagnostics(launchDiagnosticFixtures, allowed, {
      unresolvedOnly: true,
      retryableOnly: true,
    })).toHaveLength(3);
    expect(unresolvedLaunchDiagnosticCount(launchDiagnosticFixtures, allowed)).toBe(8);
  });

  it("rejects stale, concurrent, cross-tenant, or repeated resolution", () => {
    const record = launchDiagnosticFixtures[0];
    expect(canResolveLaunchDiagnostic(record, allowed, record.updatedAt)).toBe(true);
    expect(canResolveLaunchDiagnostic(record, allowed, "stale")).toBe(false);
    expect(canResolveLaunchDiagnostic(record, { ...allowed, organizationId: "other" }, record.updatedAt)).toBe(false);
    expect(canResolveLaunchDiagnostic({ ...record, resolutionState: "resolved" }, allowed, record.updatedAt)).toBe(false);
  });

  it("is disabled by default and fixture evidence contains no direct PII fields", () => {
    expect(resolveDiagnosticsMode(undefined)).toBe("disabled");
    expect(resolveDiagnosticsMode("hosted")).toBe("disabled");
    expect(resolveDiagnosticsMode("repository_fixture")).toBe("repository_fixture");
    expect(JSON.stringify(launchDiagnosticFixtures)).not.toMatch(
      /recipient_email|phone_number|transcript|service_address|message_body/i,
    );
    expect(launchDiagnosticFixtures.every((item) => item.evidenceTier === "repository_fixture")).toBe(true);
  });
});


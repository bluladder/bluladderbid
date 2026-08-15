import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BLULADDER_KLAMATH } from "./bluladderKlamath";

type MatrixScenario = {
  id: string;
  categories: string[];
  phase: "current" | "future_acceptance";
  addressAuthority: "dfw" | "klamath" | "missing";
  priorOrganization: string | null;
  requestedProvider: "jobber" | "jobtread" | null;
  serviceKey: string;
  expected: {
    decision: string;
    organization: string | null;
    provider: "jobber" | "jobtread" | null;
    dfwFallbackUsed: boolean;
    staleContextPreserved: boolean;
    providerExecutionAllowedByThisContract: boolean;
    reason: string;
  };
};

type RoutingAcceptanceMatrix = {
  schemaVersion: number;
  contract: string;
  issue: number;
  status: string;
  activationAuthorized: boolean;
  providerTrafficPerformed: boolean;
  customerMutationPerformed: boolean;
  categories: string[];
  tenantContracts: Record<string, Record<string, unknown>>;
  approvedKlamathInputs: {
    activeDays: string[];
    automatedServiceKeys: string[];
    manualReviewServiceKeys: string[];
  };
  scenarios: MatrixScenario[];
};

const matrix = JSON.parse(fs.readFileSync(new URL(
  "../../docs/operations/bluladder-klamath-dfw-routing-acceptance-matrix.json",
  import.meta.url,
), "utf8")) as RoutingAcceptanceMatrix;

const byId = (id: string) => {
  const scenario = matrix.scenarios.find((candidate) => candidate.id === id);
  expect(scenario, `missing scenario ${id}`).toBeDefined();
  return scenario!;
};

describe("BluLadder Klamath / DFW routing acceptance matrix", () => {
  it("remains repository-only and covers every required acceptance category", () => {
    expect(matrix).toMatchObject({
      schemaVersion: 1,
      contract: "bluladder-klamath-dfw-routing-acceptance-matrix",
      issue: 162,
      status: "repository_only",
      activationAuthorized: false,
      providerTrafficPerformed: false,
      customerMutationPerformed: false,
    });
    expect(new Set(matrix.categories)).toEqual(new Set([
      "address_authoritative_routing",
      "organization_isolation",
      "provider_isolation",
      "missing_address",
      "rerouting",
      "idempotency",
      "manual_review_services",
    ]));
    for (const category of matrix.categories) {
      expect(matrix.scenarios.some((scenario) =>
        scenario.categories.includes(category)
      ), `uncovered category ${category}`).toBe(true);
    }
    expect(matrix.scenarios.every((scenario) =>
      !scenario.expected.providerExecutionAllowedByThisContract
    )).toBe(true);
  });

  it("matches the approved Klamath weekdays and service subsets", () => {
    const automated = BLULADDER_KLAMATH.services
      .filter((service) => service.availability === "planned")
      .map((service) => service.serviceKey);
    const manualReview = BLULADDER_KLAMATH.services
      .filter((service) => service.availability === "manual_review")
      .map((service) => service.serviceKey);

    expect(matrix.approvedKlamathInputs).toEqual({
      activeDays: BLULADDER_KLAMATH.businessHours.activeDays,
      automatedServiceKeys: automated,
      manualReviewServiceKeys: manualReview,
    });
  });

  it("routes only from address authority and never falls back from Klamath to DFW", () => {
    expect(byId("dfw_address_selects_dfw_jobber").expected).toMatchObject({
      decision: "resolved",
      organization: "bluladder-dfw",
      provider: "jobber",
      dfwFallbackUsed: false,
    });
    expect(byId("klamath_address_blocks_while_provisioning").expected)
      .toMatchObject({
        decision: "blocked",
        organization: "bluladder-klamath",
        provider: null,
        dfwFallbackUsed: false,
        reason: "organization_inactive",
      });
    expect(byId("missing_address_fails_closed").expected).toMatchObject({
      decision: "blocked",
      organization: null,
      provider: null,
      dfwFallbackUsed: false,
      reason: "address_required",
    });
  });

  it("isolates provider selection by organization", () => {
    expect(byId("klamath_jobber_provider_mismatch_blocks").expected)
      .toMatchObject({
        decision: "blocked",
        organization: "bluladder-klamath",
        provider: null,
        reason: "provider_organization_mismatch",
      });
    expect(byId("dfw_jobtread_provider_mismatch_blocks").expected)
      .toMatchObject({
        decision: "blocked",
        organization: "bluladder-dfw",
        provider: null,
        reason: "provider_organization_mismatch",
      });
  });

  it("discards stale routing and idempotency context after address correction", () => {
    expect(byId("address_and_prior_organization_conflict_blocks").expected)
      .toMatchObject({
        decision: "blocked",
        staleContextPreserved: false,
        reason: "authority_conflict_requires_reresolution",
      });
    expect(byId("corrected_address_discards_stale_tenant_and_provider").expected)
      .toMatchObject({
        decision: "reresolve_after_activation",
        organization: "bluladder-klamath",
        provider: "jobtread",
        staleContextPreserved: false,
        reason: "corrected_address_requires_fresh_authority_and_idempotency_scope",
      });
    expect(byId("same_external_key_is_not_shared_across_tenants").expected)
      .toMatchObject({
        decision: "new_tenant_scope_after_activation",
        reason: "idempotency_is_organization_scoped",
      });
  });

  it("keeps every unapproved Klamath service on manual review", () => {
    expect(byId("manual_review_services_never_enter_automation").expected)
      .toMatchObject({
        decision: "manual_review",
        provider: null,
        reason: "service_not_approved_for_automation",
      });
    expect(matrix.approvedKlamathInputs.manualReviewServiceKeys).toEqual([
      "solar_panel_cleaning",
      "christmas_lights",
      "commercial_exterior_cleaning",
      "storefront_window_cleaning",
    ]);
  });
});

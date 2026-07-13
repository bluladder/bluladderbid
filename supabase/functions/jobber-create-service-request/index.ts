// ============================================================================
// jobber-create-service-request — SERVER-AUTHORITATIVE recurring-plan booking.
//
// The browser submits ONLY structured plan inputs (selected tier, property,
// services, add-ons, customizations, promotion, expected versions/total for
// mismatch detection, idempotency key). It NEVER submits a trusted price.
//
// Before ANY Jobber write this function:
//   1. Loads the current published pricing config.
//   2. Recalculates the exact selected plan through the canonical plan engine
//      (`computeBundleTiers` — the SAME code the customer's browser saw).
//   3. Validates the selected option is firm/selectable/complete/active and
//      rejects missing-information, manual-review, unknown-option and inactive
//      inputs.
//   4. Flags `pricing_changed` when the engine/rule version or total moved,
//      requiring a fresh customer confirmation instead of silently rebooking.
//   5. Persists a complete, immutable snapshot.
//   6. Builds Jobber line items ONLY from the recalculated server result
//      (interior windows separate; line items reconcile exactly to the total).
//
// Idempotency: the same idempotency key never creates duplicate plan records or
// duplicate Jobber quotes. Test identities are suppressed (no live Jobber write)
// so the full flow can be verified safely.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";
import { loadPricing } from "../_shared/loadPricing.ts";
import { checkSuppression } from "../_shared/suppression.ts";
import {
  computeBundleTiers,
  evaluatePlanSelection,
  planJobberLineItemsTotal,
  type EngineAdditionalServices,
  type EngineHomeDetails,
} from "../_shared/pricingEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_ID_LEN = 64;

// Structural sanitizer for per-tier customizations (identical policy to
// calculate-plan-options). Only structure is forwarded; the engine re-prices.
function sanitizeCustomizations(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [tier, c] of Object.entries(raw as Record<string, unknown>)) {
    if (!c || typeof c !== "object") continue;
    const co = c as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    if (co.windowFrequency && typeof co.windowFrequency === "object") {
      const wf = co.windowFrequency as Record<string, unknown>;
      const ext = Number(wf.exteriorFrequency);
      const int = Number(wf.interiorFrequency);
      if (Number.isFinite(ext) && Number.isFinite(int) && ext >= 0 && ext <= 12 && int >= 0 && int <= 12) {
        o.windowFrequency = { exteriorFrequency: Math.floor(ext), interiorFrequency: Math.floor(int) };
      }
    }
    if (Array.isArray(co.serviceSwaps)) {
      o.serviceSwaps = (co.serviceSwaps as unknown[])
        .filter((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).from === "string" && typeof (s as Record<string, unknown>).to === "string")
        .slice(0, 12)
        .map((s) => ({ from: String((s as Record<string, unknown>).from).slice(0, 40), to: String((s as Record<string, unknown>).to).slice(0, 40) }));
    }
    if (Array.isArray(co.addedServices)) {
      o.addedServices = (co.addedServices as unknown[])
        .filter((x) => typeof x === "string").slice(0, 12).map((x) => String(x).slice(0, 40));
    }
    out[tier.slice(0, 20)] = o;
  }
  return out;
}

function parseAddress(address: string): {
  street1: string; city: string; province: string; postalCode: string;
} {
  if (!address) return { street1: "", city: "", province: "", postalCode: "" };
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    const stateZip = parts[2].split(" ").filter(Boolean);
    return { street1: parts[0], city: parts[1], province: stateZip[0] || "", postalCode: stateZip.slice(1).join(" ") || "" };
  } else if (parts.length === 2) {
    const cityStateZip = parts[1].split(" ").filter(Boolean);
    const postalCode = cityStateZip.pop() || "";
    const province = cityStateZip.pop() || "";
    return { street1: parts[0], city: cityStateZip.join(" "), province, postalCode };
  }
  return { street1: address, city: "", province: "", postalCode: "" };
}

interface Customer {
  email: string; firstName: string; lastName: string; phone?: string; address?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ status: "error", error: "Invalid request body" }, 400);
    }
    const b = body as Record<string, unknown>;

    // ---- Structural validation (NO trusted prices) --------------------------
    const customer = b.customer as Customer | undefined;
    if (!customer?.email || !customer.firstName || !customer.lastName) {
      return json({ status: "error", error: "Missing customer information" }, 400);
    }
    const tier = typeof b.tier === "string" ? b.tier.slice(0, MAX_ID_LEN) : "";
    if (!tier) return json({ status: "error", error: "Missing plan tier" }, 400);

    const homeDetails = b.homeDetails;
    if (!homeDetails || typeof homeDetails !== "object") {
      return json({ status: "missing_information", error: "homeDetails is required", missing: ["homeDetails"] }, 400);
    }
    const additionalServices = b.additionalServices;
    if (!additionalServices || typeof additionalServices !== "object") {
      return json({ status: "missing_information", error: "additionalServices is required", missing: ["services"] }, 400);
    }

    const customizations = sanitizeCustomizations(b.customizations);
    const expectedEngineVersion = typeof b.expectedEngineVersion === "string" ? b.expectedEngineVersion : null;
    const expectedRuleVersion = Number.isFinite(Number(b.expectedRuleVersion)) ? Number(b.expectedRuleVersion) : null;
    const expectedAnnualTotal = Number.isFinite(Number(b.expectedAnnualTotal)) ? Number(b.expectedAnnualTotal) : null;
    const confirmPricingChange = b.confirmPricingChange === true;
    const idempotencyKey = typeof b.idempotencyKey === "string" && b.idempotencyKey.trim()
      ? b.idempotencyKey.slice(0, 100) : null;
    const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Idempotent replay: same key never creates a duplicate --------------
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from("quotes")
        .select("id, jobber_quote_id, total, services_json")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json({
          status: "ok",
          idempotent: true,
          quoteId: existing.id,
          jobberQuoteId: existing.jobber_quote_id,
          annualTotal: Number(existing.total),
        });
      }
    }

    // ---- 1) Load current published pricing ---------------------------------
    const loaded = await loadPricing(supabase);
    if (!loaded.ok || !loaded.pricing) {
      console.error("service-request: pricing unavailable", loaded.error, loaded.missingKeys);
      return json({ status: "pricing_unavailable", error: "Pricing is temporarily unavailable. Please try again shortly." }, 503);
    }

    // ---- 2) Recalculate the selected plan via the canonical engine ---------
    const tiersResult = computeBundleTiers(
      {
        homeDetails: homeDetails as EngineHomeDetails,
        additionalServices: additionalServices as EngineAdditionalServices,
        customizations: customizations as Record<string, never> | undefined,
      },
      loaded.pricing,
      loaded.ruleVersion,
    );

    // ---- 3) Validate + 4) detect pricing changes ---------------------------
    const outcome = evaluatePlanSelection(tiersResult, {
      tier,
      expectedEngineVersion,
      expectedRuleVersion,
      expectedAnnualTotal,
      confirmPricingChange,
    });

    if (!outcome.ok) {
      if (outcome.reason === "missing_information") {
        return json({ status: "missing_information", error: "More property information is required.", missing: outcome.missing }, 400);
      }
      if (outcome.reason === "manual_review_required") {
        return json({ status: "manual_review_required", error: "This plan requires a manual quote from our team.", reasons: outcome.manualReviewReasons }, 422);
      }
      if (outcome.reason === "unknown_option") {
        return json({ status: "unknown_option", error: outcome.detail }, 400);
      }
      // pricing_changed — return the CURRENT canonical summary; do NOT book.
      const o = outcome.option;
      return json({
        status: "pricing_changed",
        pricing_changed: true,
        error: "Pricing has been updated. Please review the new plan details and confirm.",
        current: {
          tier: o.tier,
          name: o.name,
          annualTotal: o.annualTotal,
          monthlyPayment: o.monthlyPayment,
          downPayment: o.downPayment,
          recurringMonthly: o.recurringMonthly,
          lineItems: outcome.lineItems,
          engineVersion: outcome.engineVersion,
          ruleVersion: outcome.ruleVersion,
        },
      }, 200);
    }

    const option = outcome.option;
    const lineItems = outcome.lineItems;
    // Server line items MUST reconcile exactly to the canonical annual total.
    const reconciled = planJobberLineItemsTotal(lineItems);
    if (Math.abs(reconciled - option.annualTotal) > 0.01) {
      console.error("service-request: line-item reconciliation failed", reconciled, option.annualTotal);
      return json({ status: "error", error: "Internal pricing reconciliation error." }, 500);
    }

    const installments = Number.isFinite(Number(loaded.pricing.bundle_rules?.planMonthlyInstallments)) && (loaded.pricing.bundle_rules!.planMonthlyInstallments as number) > 0
      ? Math.floor(loaded.pricing.bundle_rules!.planMonthlyInstallments as number)
      : 11;

    // ---- 5) Build the complete, immutable snapshot -------------------------
    const confirmedAt = new Date().toISOString();
    const snapshot = {
      type: "recurring-service-plan",
      engineVersion: outcome.engineVersion,
      ruleVersion: outcome.ruleVersion,
      optionId: option.tier,
      tier: option.tier,
      planName: option.name,
      planLabel: option.label,
      billingCadence: "monthly",
      windowFrequencyConfig: option.windowFrequencyConfig,
      includedServices: option.additionalServicesIncluded,
      customizations: customizations ?? null,
      promotion: (b.promotion && typeof b.promotion === "object") ? b.promotion : null,
      lineItems,
      bundleDiscount: option.bundleDiscount,
      addonDiscountPercent: option.addonDiscountPercent,
      addonSavings: option.addonSavings,
      tierBufferAdjustment: option.tierBufferAdjustment,
      annualTotal: option.annualTotal,
      monthlyPayment: option.monthlyPayment,
      downPayment: option.downPayment,
      recurringMonthly: option.recurringMonthly,
      installmentCount: installments,
      estimatedDurationMinutes: null as number | null,
      confirmedAt,
    };

    const inputSnapshot = {
      homeDetails,
      additionalServices,
      customizations: customizations ?? null,
      expected: { engineVersion: expectedEngineVersion, ruleVersion: expectedRuleVersion, annualTotal: expectedAnnualTotal },
    };

    // ---- Find or create the local customer ---------------------------------
    let { data: dbCustomer } = await supabase
      .from("customers")
      .select("*")
      .eq("email", customer.email.toLowerCase())
      .maybeSingle();
    if (!dbCustomer) {
      const { data: nc, error: ce } = await supabase
        .from("customers")
        .insert({
          email: customer.email.toLowerCase(),
          first_name: customer.firstName,
          last_name: customer.lastName,
          phone: customer.phone,
          address: customer.address,
        })
        .select()
        .single();
      if (ce) {
        console.error("Failed to create customer:", ce);
        return json({ status: "error", error: "Failed to create customer" }, 500);
      }
      dbCustomer = nc;
    }

    // ---- Reserve the plan record (idempotency guard) BEFORE any Jobber write.
    const insertRow = {
      customer_id: dbCustomer.id,
      customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
      customer_email: customer.email.toLowerCase(),
      customer_phone: customer.phone ?? null,
      services_json: snapshot,
      home_details_json: inputSnapshot,
      subtotal: option.annualTotal,
      total: option.annualTotal,
      status: "pending",
      pricing_engine_version: outcome.engineVersion,
      pricing_rule_version: outcome.ruleVersion,
      input_snapshot: inputSnapshot,
      line_item_snapshot: lineItems,
      confirmed_at: confirmedAt,
      idempotency_key: idempotencyKey,
    };

    const { data: quoteRow, error: insErr } = await supabase
      .from("quotes")
      .insert(insertRow)
      .select("id")
      .single();

    if (insErr) {
      // Unique-violation on idempotency key = concurrent duplicate; return the
      // record that won the race instead of creating a second one.
      if ((insErr as { code?: string }).code === "23505" && idempotencyKey) {
        const { data: won } = await supabase
          .from("quotes")
          .select("id, jobber_quote_id, total")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (won) {
          return json({ status: "ok", idempotent: true, quoteId: won.id, jobberQuoteId: won.jobber_quote_id, annualTotal: Number(won.total) }, 200);
        }
      }
      console.error("Failed to persist plan quote:", insErr);
      return json({ status: "error", error: "Failed to save plan" }, 500);
    }
    const quoteId = quoteRow.id;

    // ---- System-test suppression: never write live Jobber data for a test id.
    const suppression = await checkSuppression(supabase, { email: customer.email, phone: customer.phone });
    if (suppression.suppressed) {
      console.log(`service-request: suppressed Jobber write (${suppression.reason}) for quote ${quoteId}`);
      await emitBookingCompleted(supabase, quoteId, dbCustomer.id, customer, option, true);
      return json({
        status: "ok",
        suppressed: true,
        suppressionReason: suppression.reason,
        quoteId,
        jobberQuoteId: null,
        tier: option.tier,
        annualTotal: option.annualTotal,
        monthlyPayment: option.monthlyPayment,
        downPayment: option.downPayment,
        recurringMonthly: option.recurringMonthly,
        lineItems,
        engineVersion: outcome.engineVersion,
        ruleVersion: outcome.ruleVersion,
      }, 200);
    }

    // ---- 6) Create Jobber data ONLY from the recalculated server result -----
    // Find or create Jobber client.
    let jobberClientId: string | null = dbCustomer.jobber_client_id ?? null;
    if (!jobberClientId) {
      const searchResult = await jobberGraphQL<{ clients: { nodes: Array<{ id: string }> } }>(
        `query FindClient($email: String!) { clients(searchTerm: $email, first: 1) { nodes { id } } }`,
        { email: customer.email },
      );
      const existingClient = searchResult.data?.clients?.nodes?.[0];
      if (existingClient) {
        jobberClientId = existingClient.id;
      } else {
        const phoneInput = customer.phone ? [{ number: customer.phone, primary: true }] : undefined;
        const createResult = await jobberGraphQL<{ clientCreate: { client: { id: string } | null; userErrors: Array<{ message: string }> } }>(
          `mutation CreateClient($input: ClientCreateInput!) { clientCreate(input: $input) { client { id } userErrors { message path } } }`,
          { input: { firstName: customer.firstName, lastName: customer.lastName, emails: [{ address: customer.email, primary: true }], ...(phoneInput && { phones: phoneInput }) } },
        );
        if (createResult.errors?.length || createResult.data?.clientCreate?.userErrors?.length) {
          console.error("Jobber client creation failed", createResult.errors, createResult.data?.clientCreate?.userErrors);
          return json({ status: "error", error: "Failed to create client in Jobber", quoteId }, 502);
        }
        jobberClientId = createResult.data?.clientCreate?.client?.id ?? null;
      }
      if (jobberClientId) {
        await supabase.from("customers").update({ jobber_client_id: jobberClientId }).eq("id", dbCustomer.id);
      }
    }
    if (!jobberClientId) {
      return json({ status: "error", error: "Failed to resolve Jobber client", quoteId }, 502);
    }

    // Find or create property.
    let propertyId: string | null = null;
    const propRes = await jobberGraphQL<{ client: { clientProperties: { nodes: Array<{ id: string }> } } }>(
      `query GetClientProperty($clientId: EncodedId!) { client(id: $clientId) { id clientProperties(first: 1) { nodes { id } } } }`,
      { clientId: jobberClientId },
    );
    propertyId = propRes.data?.client?.clientProperties?.nodes?.[0]?.id ?? null;
    if (!propertyId) {
      const addr = parseAddress(customer.address ?? "");
      const createProp = await jobberGraphQL<{ propertyCreate: { properties: Array<{ id: string }>; userErrors: Array<{ message: string }> } }>(
        `mutation CreateProperty($clientId: EncodedId!, $input: PropertyCreateInput!) { propertyCreate(clientId: $clientId, input: $input) { properties { id } userErrors { message path } } }`,
        { clientId: jobberClientId, input: { properties: [{ address: { street1: addr.street1 || customer.address || "Service Address", city: addr.city || "Austin", province: addr.province || "TX", postalCode: addr.postalCode || "78701", country: "US" } }] } },
      );
      propertyId = createProp.data?.propertyCreate?.properties?.[0]?.id ?? null;
    }
    if (!propertyId) {
      return json({ status: "error", error: "Failed to create property in Jobber", quoteId }, 502);
    }

    // Preparation instructions (crew-facing) + recurring cadence in message.
    const cfg = option.windowFrequencyConfig;
    const cadenceLine = cfg.interiorFrequency > 0
      ? `Windows: Exterior ${cfg.exteriorFrequency}x/yr, Interior ${cfg.interiorFrequency}x/yr`
      : `Windows: Exterior ${cfg.exteriorFrequency}x/yr`;
    const promoNote = (b.promotion && typeof b.promotion === "object" && (b.promotion as Record<string, unknown>).id)
      ? `\nPromotion applied: ${String((b.promotion as Record<string, unknown>).id)}`
      : "";
    const quoteMessage = [
      `${option.name} (${option.label}) — 12-Month Recurring Service Plan`,
      ``,
      `Billing: $${option.downPayment} due today, then ${installments} × $${option.recurringMonthly}/month`,
      `Annual Plan Total: $${option.annualTotal}`,
      cadenceLine,
      ``,
      `Home: ${(homeDetails as Record<string, unknown>).squareFootage ?? "N/A"} sq ft, ${(homeDetails as Record<string, unknown>).stories ?? 1} story`,
      `PREP: Confirm access, water spigot availability, and pet/vehicle clearance before each visit.`,
      notes ? `\nCustomer Notes: ${notes}` : "",
      promoNote,
    ].filter(Boolean).join("\n");

    const jobberLineItems = lineItems.map((li) => ({
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      saveToProductsAndServices: false,
    }));

    const quoteResult = await jobberGraphQL<{ quoteCreate: { quote: { id: string; quoteNumber: number } | null; userErrors: Array<{ message: string }> } }>(
      `mutation CreateQuote($attributes: QuoteCreateAttributes!) { quoteCreate(attributes: $attributes) { quote { id quoteNumber title } userErrors { message path } } }`,
      { attributes: { clientId: jobberClientId, propertyId, title: `${option.name} - Annual Service Plan`, message: quoteMessage, lineItems: jobberLineItems } },
    );

    if (quoteResult.errors?.length || quoteResult.data?.quoteCreate?.userErrors?.length) {
      // Fail-closed: leave the plan record pending (not booked) for follow-up.
      console.error("Jobber quote creation failed", quoteResult.errors, quoteResult.data?.quoteCreate?.userErrors);
      return json({ status: "error", error: "Failed to create quote in Jobber", quoteId }, 502);
    }

    const jobberQuoteId = quoteResult.data?.quoteCreate?.quote?.id ?? null;
    const jobberQuoteNumber = quoteResult.data?.quoteCreate?.quote?.quoteNumber ?? null;

    await supabase.from("quotes").update({ jobber_quote_id: jobberQuoteId }).eq("id", quoteId);

    // booking_completed — the recurring plan quote was successfully created.
    // Idempotent on the local quote id; STOPs abandoned-quote nurture.
    await emitBookingCompleted(supabase, quoteId, dbCustomer.id, customer, option, false);

    return json({
      status: "ok",
      quoteId,
      jobberQuoteId,
      jobberQuoteNumber,
      tier: option.tier,
      annualTotal: option.annualTotal,
      monthlyPayment: option.monthlyPayment,
      downPayment: option.downPayment,
      recurringMonthly: option.recurringMonthly,
      lineItems,
      engineVersion: outcome.engineVersion,
      ruleVersion: outcome.ruleVersion,
    }, 200);
  } catch (error) {
    console.error("Service request error:", error);
    return json({ status: "error", error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

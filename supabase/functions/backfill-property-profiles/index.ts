// ============================================================================
// backfill-property-profiles — one-shot, idempotent admin backfill that turns
// the customer-level `customers.address` string into normalized rows in
// `properties` + `customer_properties`, links historical `bookings` and
// `quotes` to that property, and seeds `property_facts` from their
// `home_details_json` (source = "booking" / "prior_quote").
//
// Address source of truth: `customers.address`. Neither `bookings` nor
// `quotes` carries its own address column in this schema — the address is
// carried by the customer record and inherited into historical jobs.
//
// Guardrails:
//   * Operations-admin only.
//   * Fully idempotent — safe to run repeatedly. `properties` is deduped on
//     `normalized_address`, `customer_properties` on (customer_id, property_id),
//     and facts are inserted through `proposePropertyFact` so existing
//     technician/admin/jobber facts are never overwritten.
//   * Never mutates `quotes.customer_id` or `bookings.customer_id`. It only
//     links a discovered property_id back to the source record.
//   * Never stores historical quoted PRICES as reusable facts — only
//     dimension/material/count inputs. Prices are always re-run through the
//     pricing engine, never rehydrated.
//   * `serviceFactMap` enforces that house_sqft can never be used as
//     driveway/patio sqft.
//   * Bounded per run: `?limit=N` (default 200) to keep responses short.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  linkCustomerToProperty,
  proposePropertyFact,
  upsertPropertyByAddress,
} from "../_shared/profile/propertyRepo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return j(401, { error: "auth_required" });

    const authed = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userRes } = await authed.auth.getUser();
    if (!userRes?.user) return j(401, { error: "not_signed_in" });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: allowed } = await svc.rpc("has_admin_level", {
      _user_id: userRes.user.id,
      _min_level: "operations_admin",
    });
    if (!allowed) return j(403, { error: "operations_admin_required" });

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 500);
    const dry = url.searchParams.get("dry") === "1";

    const report = {
      customers_inspected: 0,
      customers_resolved: 0,
      properties_would_create: 0,
      properties_would_link: 0,
      facts_would_insert: 0,
      facts_skipped_existing: 0,
      conflicts: 0,
      ambiguous_addresses: 0,
      skipped_no_address: 0,
      failures: 0,
      bookings_linked: 0,
      quotes_linked: 0,
    };
    const examples: unknown[] = [];

    const { data: customers } = await svc.from("customers")
      .select("id, first_name, last_name, address")
      .not("address", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const c of customers ?? []) {
      report.customers_inspected++;
      const addr = String(c.address ?? "").trim();
      if (!addr) { report.skipped_no_address++; continue; }

      // Simulate the property upsert without writing during dry runs.
      const { parseAddress } = await import("../_shared/profile/normalizeAddress.ts");
      const parsed = parseAddress(addr);
      if (!parsed.normalized) { report.skipped_no_address++; continue; }

      const { data: existingProp } = await svc.from("properties")
        .select("id").eq("normalized_address", parsed.normalized).maybeSingle();
      let propertyId = existingProp?.id ?? null;
      const wouldCreate = !propertyId;

      if (dry) {
        if (wouldCreate) report.properties_would_create++;
      } else {
        const up = await upsertPropertyByAddress(svc, addr);
        if (!up.ok || !up.propertyId) { report.failures++; continue; }
        propertyId = up.propertyId;
        if (up.created) report.properties_would_create++;
      }

      report.customers_resolved++;

      // Link check.
      let wouldLink = true;
      if (propertyId) {
        const { data: link } = await svc.from("customer_properties")
          .select("id").eq("customer_id", c.id).eq("property_id", propertyId).maybeSingle();
        wouldLink = !link;
      }
      if (wouldLink) report.properties_would_link++;
      if (!dry && propertyId) {
        await linkCustomerToProperty(svc, {
          customerId: c.id, propertyId, relationshipType: "owner", isPrimary: true,
        });
      }

      // Historical bookings for this customer.
      const { data: bookings } = await svc.from("bookings")
        .select("id, home_details_json, property_id")
        .eq("customer_id", c.id).is("property_id", null);
      for (const b of bookings ?? []) {
        report.bookings_linked++;
        if (!dry && propertyId) {
          await svc.from("bookings").update({ property_id: propertyId }).eq("id", b.id);
        }
        await seedFactsFromHomeDetails(
          svc, propertyId, b.home_details_json, "booking", b.id, report, dry,
        );
      }

      // Historical quotes for this customer.
      const { data: quotes } = await svc.from("quotes")
        .select("id, home_details_json, property_id")
        .eq("customer_id", c.id).is("property_id", null);
      for (const q of quotes ?? []) {
        report.quotes_linked++;
        if (!dry && propertyId) {
          await svc.from("quotes").update({ property_id: propertyId }).eq("id", q.id);
        }
        await seedFactsFromHomeDetails(
          svc, propertyId, q.home_details_json, "prior_quote", q.id, report, dry,
        );
      }

      if (examples.length < 8) {
        examples.push({
          customer_id_prefix: String(c.id).slice(0, 8),
          address_normalized_prefix: parsed.normalized.slice(0, 24) + "…",
          property_would_create: wouldCreate,
          existing_bookings_linked: (bookings ?? []).length,
          existing_quotes_linked: (quotes ?? []).length,
        });
      }
    }

    return j(200, { ok: true, dry, report, examples });
  } catch (e) {
    return j(500, { error: "internal_error", detail: String(e).slice(0, 200) });
  }
});

async function seedFactsFromHomeDetails(
  svc: any,
  propertyId: string | null,
  home: any,
  source: "booking" | "prior_quote",
  sourceRecordId: string,
  report: {
    facts_would_insert: number;
    facts_skipped_existing: number;
    conflicts: number;
  },
  dry: boolean,
) {
  if (!home || typeof home !== "object") return;
  const seed = async (factType: string, valueNumeric?: number | null, valueText?: string | null, unit?: string) => {
    if (valueNumeric == null && !valueText) return;
    if (dry || !propertyId) {
      // Simulate: check whether a current row already exists for this type.
      if (propertyId) {
        const { data: existing } = await svc.from("property_facts_current")
          .select("value_numeric, value_text, source")
          .eq("property_id", propertyId).eq("fact_type", factType).maybeSingle();
        if (existing) {
          const oldNum = existing.value_numeric;
          const oldTxt = existing.value_text;
          const numConflict = valueNumeric != null && oldNum != null
            && Math.abs(Number(oldNum) - valueNumeric) > 25
            && Math.abs(Number(oldNum) - valueNumeric) / Math.max(Number(oldNum), 1) > 0.05;
          const txtConflict = valueText != null && oldTxt != null
            && String(oldTxt).toLowerCase().trim() !== String(valueText).toLowerCase().trim();
          if (numConflict || txtConflict) report.conflicts++;
          else report.facts_skipped_existing++;
          return;
        }
      }
      report.facts_would_insert++;
      return;
    }
    const r = await proposePropertyFact(svc, {
      propertyId, factType: factType as any,
      valueNumeric: valueNumeric ?? null,
      valueText: valueText ?? null,
      unit: unit ?? null,
      source, sourceRecordId,
      createdByType: "system_backfill",
    });
    if (r.ok) {
      if (r.conflict) report.conflicts++;
      else report.facts_would_insert++;
    } else {
      // Non-ok = failed insert; count as skipped so we don't lie about progress.
      report.facts_skipped_existing++;
    }
  };
  await seed("house_sqft", Number(home.squareFootage) || null, null, "sqft");
  await seed("stories", Number(home.stories) || null);
  if (home.additionalServices?.drivewayCleaning?.sqft) {
    await seed("driveway_sqft", Number(home.additionalServices.drivewayCleaning.sqft), null, "sqft");
  }
  if (home.additionalServices?.drivewayCleaning?.surfaceType) {
    await seed("driveway_material", null, String(home.additionalServices.drivewayCleaning.surfaceType));
  }
  if (home.additionalServices?.houseWashDetails?.sidingMaterial) {
    await seed("siding_material", null, String(home.additionalServices.houseWashDetails.sidingMaterial));
  }
  if (home.additionalServices?.solarPanelCleaning?.panelCount) {
    await seed("solar_panel_count", Number(home.additionalServices.solarPanelCleaning.panelCount));
  }
  if (home.roofPitch) await seed("roof_pitch_category", null, String(home.roofPitch));
  if (home.additionalServices?.roofPitch) {
    await seed("roof_pitch_category", null, String(home.additionalServices.roofPitch));
  }
}
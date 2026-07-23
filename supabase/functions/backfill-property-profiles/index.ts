// ============================================================================
// backfill-property-profiles — one-shot, idempotent admin backfill that turns
// historical text/JSON addresses in `quotes` and `bookings` into normalized
// rows in `properties` + `customer_properties`, and seeds `property_facts`
// from prior quote inputs (with source = "prior_quote" / "booking").
//
// Guardrails:
//   * Operations-admin only.
//   * Fully idempotent — safe to run repeatedly. `properties` is deduped on
//     `normalized_address`, `customer_properties` on (customer_id, property_id),
//     and facts are inserted through `proposePropertyFact` so existing
//     technician/admin/jobber facts are never overwritten.
//   * Never mutates `quotes.customer_id` or `bookings.customer_id`. It only
//     links a discovered property_id back to the source record.
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

    const report = { scanned: 0, propertiesCreated: 0, propertiesLinked: 0, factsProposed: 0, skipped: 0 };

    // Bookings first (they have the strongest ground truth: reference_number + start).
    const { data: bookings } = await svc.from("bookings")
      .select("id, customer_id, service_address, home_details_json, property_id")
      .is("property_id", null)
      .not("customer_id", "is", null)
      .not("service_address", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    for (const b of bookings ?? []) {
      report.scanned++;
      const up = await upsertPropertyByAddress(svc, b.service_address);
      if (!up.ok || !up.propertyId) { report.skipped++; continue; }
      if (up.created) report.propertiesCreated++;
      if (!dry) {
        await linkCustomerToProperty(svc, {
          customerId: b.customer_id, propertyId: up.propertyId,
          relationshipType: "owner", isPrimary: true,
        });
        await svc.from("bookings").update({ property_id: up.propertyId }).eq("id", b.id);
        report.propertiesLinked++;
        await seedFactsFromHomeDetails(svc, up.propertyId, b.home_details_json, "booking", b.id, report);
      }
    }

    // Quotes: same treatment but source = "prior_quote".
    const { data: quotes } = await svc.from("quotes")
      .select("id, customer_id, service_address, home_details_json, property_id")
      .is("property_id", null)
      .not("customer_id", "is", null)
      .not("service_address", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    for (const q of quotes ?? []) {
      report.scanned++;
      const up = await upsertPropertyByAddress(svc, q.service_address);
      if (!up.ok || !up.propertyId) { report.skipped++; continue; }
      if (up.created) report.propertiesCreated++;
      if (!dry) {
        await linkCustomerToProperty(svc, {
          customerId: q.customer_id, propertyId: up.propertyId,
          relationshipType: "owner",
        });
        await svc.from("quotes").update({ property_id: up.propertyId }).eq("id", q.id);
        report.propertiesLinked++;
        await seedFactsFromHomeDetails(svc, up.propertyId, q.home_details_json, "prior_quote", q.id, report);
      }
    }

    return j(200, { ok: true, dry, report });
  } catch (e) {
    return j(500, { error: "internal_error", detail: String(e).slice(0, 200) });
  }
});

async function seedFactsFromHomeDetails(
  svc: any,
  propertyId: string,
  home: any,
  source: "booking" | "prior_quote",
  sourceRecordId: string,
  report: { factsProposed: number },
) {
  if (!home || typeof home !== "object") return;
  const seed = async (factType: string, valueNumeric?: number | null, valueText?: string | null, unit?: string) => {
    if (valueNumeric == null && !valueText) return;
    const r = await proposePropertyFact(svc, {
      propertyId, factType: factType as any,
      valueNumeric: valueNumeric ?? null,
      valueText: valueText ?? null,
      unit: unit ?? null,
      source, sourceRecordId,
      createdByType: "system_backfill",
    });
    if (r.ok) report.factsProposed++;
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
}
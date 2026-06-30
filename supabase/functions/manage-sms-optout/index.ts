import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone, isPhoneOptedOut } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Customer self-service opt-out. Identified by the email they booked with
// (same posture as customer-lookup). The phone is derived server-side from the
// customer record, so callers can only affect their own number.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, action = "status" } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["status", "opt_out", "opt_in"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: customer } = await supabase
      .from("customers")
      .select("id, phone")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const phone = normalizePhone(customer?.phone);
    if (!customer || !phone) {
      return new Response(JSON.stringify({ hasPhone: false, optedOut: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();

    if (action === "opt_out") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: true, source: "customer_portal",
        reason: "Customer opted out via portal", opted_out_at: nowIso,
      }, { onConflict: "phone" });
      // Cancel pending queued texts.
      await supabase.from("sms_messages")
        .update({ status: "cancelled", error: "Recipient opted out (portal)" })
        .eq("to_number", phone).eq("status", "pending");
      return new Response(JSON.stringify({ hasPhone: true, optedOut: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "opt_in") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: false, source: "customer_portal",
        reason: "Customer opted in via portal", opted_in_at: nowIso,
      }, { onConflict: "phone" });
      return new Response(JSON.stringify({ hasPhone: true, optedOut: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // status
    const optedOut = await isPhoneOptedOut(supabase, phone);
    // Mask the phone for display (last 4 digits).
    const last4 = phone.slice(-4);
    return new Response(JSON.stringify({ hasPhone: true, optedOut, phoneLast4: last4 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("manage-sms-optout error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

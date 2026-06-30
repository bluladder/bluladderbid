import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone, isPhoneOptedOut } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Customer self-service message preferences. Identified by the email they
// booked with (same posture as customer-lookup). For SMS, the phone is derived
// server-side from the customer record so callers can only affect their own
// number. Email pausing flips a per-lead flag on the customer record.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, action = "status", channel = "sms" } = await req.json();

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
    if (!["sms", "email"].includes(channel)) {
      return new Response(JSON.stringify({ error: "Invalid channel" }), {
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
      .select("id, phone, email, sms_paused, email_paused")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const phone = normalizePhone(customer?.phone);
    const nowIso = new Date().toISOString();

    const buildStatus = async () => {
      const optedOut = phone ? await isPhoneOptedOut(supabase, phone) : false;
      const smsOptedOut = optedOut || !!customer?.sms_paused;
      return {
        hasPhone: !!phone,
        hasEmail: !!customer?.email,
        phoneLast4: phone ? phone.slice(-4) : undefined,
        emailMasked: customer?.email
          ? customer.email.replace(/^(.).*(@.*)$/, (_m: string, a: string, b: string) => `${a}***${b}`)
          : undefined,
        sms: { optedOut: smsOptedOut },
        email: { paused: !!customer?.email_paused },
        // backwards-compat (older clients expected a flat sms opt-out flag):
        optedOut: smsOptedOut,
      };
    };

    if (!customer) {
      return new Response(JSON.stringify({
        hasPhone: false, hasEmail: false,
        sms: { optedOut: false }, email: { paused: false }, optedOut: false,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- EMAIL channel ----
    if (channel === "email") {
      if (action === "opt_out") {
        await supabase.from("customers").update({ email_paused: true }).eq("id", customer.id);
        await supabase.from("sms_messages")
          .update({ status: "cancelled", error: "Email paused (portal)" })
          .eq("customer_id", customer.id).eq("channel", "email").eq("status", "pending");
        customer.email_paused = true;
      } else if (action === "opt_in") {
        await supabase.from("customers").update({ email_paused: false }).eq("id", customer.id);
        customer.email_paused = false;
      }
      return new Response(JSON.stringify(await buildStatus()), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SMS channel ----
    if (!phone) {
      return new Response(JSON.stringify(await buildStatus()), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "opt_out") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: true, source: "customer_portal",
        reason: "Customer opted out via portal", opted_out_at: nowIso,
      }, { onConflict: "phone" });
      await supabase.from("sms_messages")
        .update({ status: "cancelled", error: "Recipient opted out (portal)" })
        .eq("to_number", phone).eq("status", "pending");
    } else if (action === "opt_in") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: false, source: "customer_portal",
        reason: "Customer opted in via portal", opted_in_at: nowIso,
      }, { onConflict: "phone" });
    }

    return new Response(JSON.stringify(await buildStatus()), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("manage-sms-optout error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

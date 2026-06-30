import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getCallRailConfig,
  sendCallRailSms,
  renderTemplate,
  formatApptDate,
  normalizePhone,
  isPhoneOptedOut,
} from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APP_URL = Deno.env.get("APP_URL") || "https://bluladderbid.lovable.app";

type EventType =
  | "quote_created"
  | "appointment_scheduled"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "appointment_completed";

interface SendSmsRequest {
  // Either an event-driven send...
  eventType?: EventType;
  bookingId?: string;
  quoteId?: string;
  // ...or a direct/manual send.
  to?: string;
  body?: string;
}

function formatPrice(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n);
  if (!isFinite(num)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(num);
}

// Default transactional templates (used when no campaign step overrides for the immediate message).
const DEFAULT_TEMPLATES: Record<EventType, string> = {
  quote_created:
    "Hi {{first_name}}, your BluLadder quote is ready! View it here: {{quote_link}}",
  appointment_scheduled:
    "Hi {{first_name}}, your BluLadder appointment for {{service}} is scheduled for {{date}} with arrival around {{time}}. Ref {{reference}}.",
  appointment_rescheduled:
    "Hi {{first_name}}, your BluLadder appointment for {{service}} has been rescheduled to {{date}} with arrival around {{time}}. Ref {{reference}}.",
  appointment_cancelled:
    "Hi {{first_name}}, your BluLadder appointment (Ref {{reference}}) has been cancelled. Questions? Reply here or call us.",
  appointment_completed:
    "Hi {{first_name}}, thank you for choosing BluLadder! We hope you love the results.",
};

function serviceNames(servicesJson: unknown): string {
  try {
    if (Array.isArray(servicesJson)) {
      return servicesJson.map((s: { name?: string }) => s?.name).filter(Boolean).join(", ");
    }
    // Plan-builder quotes store { services: [...] }
    const obj = servicesJson as { services?: Array<{ name?: string }> };
    if (obj?.services && Array.isArray(obj.services)) {
      return obj.services.map((s) => s?.name).filter(Boolean).join(", ");
    }
  } catch { /* ignore */ }
  return "your service";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const config = getCallRailConfig();
    const body: SendSmsRequest = await req.json();

    // ---- Direct / manual send ----
    if (body.to && body.body) {
      // Manual arbitrary sends must come from an authenticated admin (prevents open SMS relay).
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");
      if (!token) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: userData } = await supabase.auth.getUser(token);
      const uid = userData?.user?.id;
      if (!uid) {
        return new Response(JSON.stringify({ error: "Invalid session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await supabase.rpc("has_admin_level", { _user_id: uid, _min_level: "operations_admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const toNorm = normalizePhone(body.to);
      // Respect opt-outs even for manual admin sends.
      if (await isPhoneOptedOut(supabase, toNorm)) {
        await supabase.from("sms_messages").insert({
          to_number: toNorm || body.to, body: body.body, message_kind: "manual",
          status: "cancelled", error: "Recipient has opted out of texts",
        });
        return new Response(JSON.stringify({ success: false, error: "Recipient has opted out of texts" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: row } = await supabase
        .from("sms_messages")
        .insert({ to_number: toNorm || body.to, body: body.body, message_kind: "manual", status: "pending" })
        .select("id")
        .single();

      if (!config) {
        await supabase.from("sms_messages").update({ status: "failed", error: "CallRail not configured" }).eq("id", row?.id);
        return new Response(JSON.stringify({ success: false, error: "CallRail not configured" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await sendCallRailSms(config, body.to, body.body);
      await supabase.from("sms_messages").update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        callrail_message_id: result.messageId ?? null,
        error: result.error ?? null,
        attempts: 1,
      }).eq("id", row?.id);

      return new Response(JSON.stringify({ success: result.ok, error: result.error }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { eventType, bookingId, quoteId } = body;
    if (!eventType) {
      return new Response(JSON.stringify({ error: "eventType or (to + body) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Build variable context ----
    let phone: string | null = null;
    let firstName = "there";
    let lastName = "";
    const vars: Record<string, string | number> = {};

    if (bookingId) {
      const { data: bk } = await supabase
        .from("bookings")
        .select("reference_number, scheduled_start, total, services_json, customer:customers(first_name, last_name, phone)")
        .eq("id", bookingId)
        .single();
      if (bk) {
        const cust = bk.customer as { first_name?: string; last_name?: string; phone?: string } | null;
        phone = cust?.phone ?? null;
        firstName = cust?.first_name || firstName;
        lastName = cust?.last_name || "";
        const { date, time } = formatApptDate(bk.scheduled_start as string);
        vars.reference = bk.reference_number as string ?? "";
        vars.service = serviceNames(bk.services_json);
        vars.date = date;
        vars.time = time;
        vars.total = formatPrice(bk.total);
        vars.appointment_link = `${APP_URL}/my-appointments`;
      }
    } else if (quoteId) {
      const { data: q } = await supabase
        .from("quotes")
        .select("customer_name, customer_phone, total, services_json")
        .eq("id", quoteId)
        .single();
      if (q) {
        phone = q.customer_phone as string ?? null;
        firstName = ((q.customer_name as string) || "").trim().split(/\s+/)[0] || firstName;
        vars.service = serviceNames(q.services_json);
        vars.total = formatPrice(q.total);
        vars.quote_link = `${APP_URL}/quote/${quoteId}`;
      }
    }

    vars.first_name = firstName;
    vars.last_name = lastName;
    vars.full_name = `${firstName} ${lastName}`.trim();

    const toNorm = normalizePhone(phone);

    // ---- 1) Immediate transactional message ----
    const immediateBody = renderTemplate(DEFAULT_TEMPLATES[eventType], vars);
    let transactionalSent = false;
    let transactionalError: string | undefined;

    const { data: txRow } = await supabase
      .from("sms_messages")
      .insert({
        to_number: toNorm || phone || "unknown",
        body: immediateBody,
        message_kind: "transactional",
        status: "pending",
        booking_id: bookingId ?? null,
        quote_id: quoteId ?? null,
      })
      .select("id")
      .single();

    if (!toNorm) {
      await supabase.from("sms_messages").update({ status: "failed", error: "No valid phone number" }).eq("id", txRow?.id);
      transactionalError = "No valid phone number on record";
    } else if (!config) {
      await supabase.from("sms_messages").update({ status: "failed", error: "CallRail not configured" }).eq("id", txRow?.id);
      transactionalError = "CallRail not configured";
    } else {
      const result = await sendCallRailSms(config, toNorm, immediateBody);
      transactionalSent = result.ok;
      transactionalError = result.error;
      await supabase.from("sms_messages").update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        callrail_message_id: result.messageId ?? null,
        error: result.error ?? null,
        attempts: 1,
      }).eq("id", txRow?.id);
    }

    // ---- 2) Enroll active follow-up campaigns for this event ----
    let scheduledCount = 0;
    const { data: campaigns } = await supabase
      .from("sms_campaigns")
      .select("id, sms_campaign_steps(id, step_order, delay_hours, body_template, active)")
      .eq("trigger_event", eventType)
      .eq("active", true);

    if (campaigns && toNorm) {
      const now = Date.now();
      const rows: Record<string, unknown>[] = [];
      for (const c of campaigns as Array<{ id: string; sms_campaign_steps: Array<{ id: string; delay_hours: number; body_template: string; active: boolean }> }>) {
        for (const step of c.sms_campaign_steps || []) {
          if (!step.active) continue;
          rows.push({
            to_number: toNorm,
            body: renderTemplate(step.body_template, vars),
            message_kind: "campaign",
            status: "pending",
            booking_id: bookingId ?? null,
            quote_id: quoteId ?? null,
            campaign_id: c.id,
            campaign_step_id: step.id,
            send_at: new Date(now + Number(step.delay_hours) * 3600 * 1000).toISOString(),
          });
        }
      }
      if (rows.length) {
        const { error: insErr, count } = await supabase.from("sms_messages").insert(rows, { count: "exact" });
        if (!insErr) scheduledCount = count ?? rows.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      transactionalSent,
      transactionalError,
      scheduledFollowUps: scheduledCount,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("send-sms error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
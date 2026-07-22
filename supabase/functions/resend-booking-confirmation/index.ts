// ============================================================================
// resend-booking-confirmation — admin-only one-shot replacement send.
//
// Reconstructs the same emailCtx the canonical booking flow builds and calls
// the shared sendBookingConfirmationEmails(), so identical templates and
// suppression rules apply. Uses the standard notification_events dedupe —
// callers wanting to re-send after a historical suppression must clear the
// prior suppressed row first (migration path, never a client call).
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { sendBookingConfirmationEmails, type BookingEmailContext } from "../_shared/bookingEmails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gate = await requireAdminOrService(req, "operations_admin");
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : "";
  if (!bookingId) {
    return new Response(JSON.stringify({ error: "bookingId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: bk, error } = await supabase
    .from("bookings")
    .select(
      "id, reference_number, scheduled_start, scheduled_end, total, subtotal, discount_amount, discount_code, jobber_visit_id, jobber_job_id, duration_minutes, technician_name, services_json, customer_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !bk) {
    console.error("resend-booking-confirmation lookup failed", { bookingId, error, bk });
    return new Response(JSON.stringify({ error: "Booking not found", detail: error?.message ?? null }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: cust } = await supabase
    .from("customers")
    .select("first_name, last_name, email, phone, address")
    .eq("id", bk.customer_id as string)
    .maybeSingle();
  if (!bk.jobber_visit_id) {
    return new Response(JSON.stringify({ error: "Booking has no Jobber visit id" }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const c = (cust ?? {}) as {
    first_name?: string; last_name?: string; email?: string; phone?: string | null; address?: string;
  };
  const services = Array.isArray(bk.services_json)
    ? (bk.services_json as Array<{ name: string; price?: number; quantity?: number }>).map((s) => ({
        name: s.name, price: s.price, quantity: s.quantity,
      }))
    : [];

  const ctx: BookingEmailContext = {
    bookingId: bk.id as string,
    referenceNumber: (bk.reference_number as string) ?? "",
    jobberVisitId: bk.jobber_visit_id as string,
    jobberJobId: (bk.jobber_job_id as string) ?? null,
    scheduledStart: bk.scheduled_start as string,
    scheduledEnd: bk.scheduled_end as string,
    serviceAddress: c.address ?? "",
    services,
    subtotal: Number(bk.subtotal ?? bk.total ?? 0),
    discountAmount: Number(bk.discount_amount ?? 0),
    discountCode: (bk.discount_code as string) ?? null,
    total: Number(bk.total ?? 0),
    technicianName: (bk.technician_name as string) ?? "BluLadder Service Team",
    durationMinutes: (bk.duration_minutes as number) ?? null,
    customer: {
      firstName: c.first_name ?? "",
      lastName: c.last_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? null,
    },
  };

  const result = await sendBookingConfirmationEmails(supabase, ctx);
  return new Response(JSON.stringify({
    ok: true,
    customer: { status: result.customer.status, providerMessageId: result.customer.providerMessageId, dedup: result.customer.dedup, error: result.customer.errorMessage },
    owner: { status: result.owner.status, providerMessageId: result.owner.providerMessageId, dedup: result.owner.dedup, error: result.owner.errorMessage },
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
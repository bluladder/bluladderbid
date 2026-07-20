// Admin → Security → Customer Access Live Tests
//
// Three independently-scoped controlled tests, each requiring an explicit
// authorization + confirm-and-send cycle. Nothing is sent automatically. An
// authorization for one test type cannot be used for another because the RPC
// scopes by (test_type, idempotency_key) and consumes atomically once.
//
// No raw OTPs, portal tokens, management tokens or credentials are ever
// displayed here — only provider message ids, correlation ids and sanitized
// delivery status.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminPermissions } from "@/hooks/useAdminPermissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2, AlertTriangle, MessageSquare, Mail, LinkIcon, Info } from "lucide-react";

const APPROVED_TEST_EMAIL = "blmillen@gmail.com";
const APPROVED_TEST_PHONE = "+14692150144";

type TestType = "sms_otp" | "email_otp" | "booking_link_sms";
type Phase =
  | "requires_configuration"
  | "ready"
  | "authorizing"
  | "authorized"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "suppressed"
  | "consumed"
  | "expired";

interface TestState {
  phase: Phase;
  correlationId?: string;
  authorizationId?: string;
  expiresAt?: string;
  idempotencyKey?: string;
  lastResult?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_STATE: TestState = { phase: "ready" };

function phaseTone(p: Phase): string {
  if (p === "sent" || p === "delivered" || p === "authorized") return "bg-green-100 text-green-800";
  if (p === "failed" || p === "expired") return "bg-red-100 text-red-800";
  if (p === "requires_configuration" || p === "suppressed") return "bg-amber-100 text-amber-800";
  if (p === "authorizing" || p === "sending") return "bg-blue-100 text-blue-800";
  return "bg-muted text-muted-foreground";
}

function randomIdKey(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${Date.now()}-${hex}`;
}

export function CustomerAccessLiveTestsPanel() {
  const { canOverrideBookings, loading } = useAdminPermissions();
  const [states, setStates] = useState<Record<TestType, TestState>>({
    sms_otp: { ...DEFAULT_STATE },
    email_otp: { ...DEFAULT_STATE, phase: "requires_configuration" },
    booking_link_sms: { ...DEFAULT_STATE },
  });
  const [smtpConfirmed, setSmtpConfirmed] = useState(false);
  const [fixtureId, setFixtureId] = useState<string | null>(null);

  // Look up an existing test-fixture booking on mount.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("bookings")
        .select("id")
        .eq("is_test_fixture", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mounted && data?.id) setFixtureId(data.id);
    })();
    return () => { mounted = false; };
  }, []);

  // Precompute the SMTP-unknown alert BEFORE any early return so React hook
  // order is stable across the loading / permission-denied branches.
  const smtpUnknown = useMemo(() => (
    <Alert>
      <Info className="w-4 h-4" />
      <AlertTitle>Custom SMTP readiness: unknown — manual verification required</AlertTitle>
      <AlertDescription className="space-y-1 text-sm">
        <p>Supabase Auth SMTP settings are not readable from this admin surface.</p>
        <p>In Cloud → Users → Auth Settings, confirm:</p>
        <ul className="list-disc ml-5">
          <li>Custom SMTP is enabled (not the built-in demonstration mailer)</li>
          <li>Sender name is <strong>BluLadder Secure Access</strong></li>
          <li>Sender address is <strong>alerts@admin.bluladder.com</strong></li>
          <li><code>admin.bluladder.com</code> is verified</li>
        </ul>
        <label className="flex items-center gap-2 pt-2">
          <Checkbox checked={smtpConfirmed} onCheckedChange={(v) => setSmtpConfirmed(v === true)} />
          <span>I have visually verified the above in Cloud → Users → Auth Settings.</span>
        </label>
      </AlertDescription>
    </Alert>
  ), [smtpConfirmed]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking permissions…
      </div>
    );
  }
  if (!canOverrideBookings) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="w-4 h-4" />
        <AlertTitle>Operations admin required</AlertTitle>
        <AlertDescription>You do not have permission to run controlled customer-access tests.</AlertDescription>
      </Alert>
    );
  }

  function updateState(t: TestType, patch: Partial<TestState>) {
    setStates((prev) => ({ ...prev, [t]: { ...prev[t], ...patch } }));
  }

  async function authorize(t: TestType, recipient: string, targetId: string | null) {
    if (t === "email_otp" && !smtpConfirmed) {
      toast({ title: "SMTP not confirmed", description: "Confirm custom SMTP verification before authorizing the email test.", variant: "destructive" });
      return;
    }
    updateState(t, { phase: "authorizing", error: undefined, lastResult: undefined });
    const key = randomIdKey(t);
    const { data, error } = await supabase.rpc("authorize_customer_access_test", {
      p_test_type: t,
      p_recipient: recipient,
      p_target_id: targetId,
      p_idempotency_key: key,
      p_ttl_minutes: 15,
    });
    if (error) {
      updateState(t, { phase: "failed", error: error.message });
      return;
    }
    const row = (data ?? {}) as { id?: string; correlation_id?: string; expires_at?: string };
    updateState(t, {
      phase: "authorized",
      authorizationId: row.id,
      correlationId: row.correlation_id,
      expiresAt: row.expires_at,
      idempotencyKey: key,
    });
  }

  async function send(t: TestType) {
    const state = states[t];
    if (!state.idempotencyKey || state.phase !== "authorized") return;
    if (!confirm(`Send exactly one ${t.replace(/_/g, " ")} to the approved test identity now?`)) return;
    updateState(t, { phase: "sending", error: undefined });
    const { data, error } = await supabase.functions.invoke("customer-access-live-test", {
      body: { test_type: t, idempotency_key: state.idempotencyKey },
    });
    if (error) {
      updateState(t, { phase: "failed", error: error.message, lastResult: undefined });
      return;
    }
    const res = (data ?? {}) as Record<string, unknown>;
    const status = String(res.status ?? "failed");
    updateState(t, {
      phase: status === "sent" ? "sent" : status === "failed" ? "failed" : "consumed",
      lastResult: res,
      error: typeof res.error === "string" ? res.error : undefined,
    });
  }

  async function ensureFixture() {
    const { data, error } = await supabase.rpc("create_customer_access_test_booking_fixture");
    if (error) {
      toast({ title: "Fixture failed", description: error.message, variant: "destructive" });
      return;
    }
    setFixtureId(data as string);
    toast({ title: "Test-fixture booking ready", description: "Hidden admin-only booking created." });
  }

  const smsState = states.sms_otp;
  const emailState = states.email_otp;
  const linkState = states.booking_link_sms;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-primary mt-1" />
        <div>
          <h2 className="text-2xl font-bold">Customer Access Live Tests</h2>
          <p className="text-sm text-muted-foreground">
            One authorized, single-use send per action. Recipient is the approved protected test identity. No marketing consent is created, no campaign is triggered, no Jobber record is written, no Meta event is fired.
          </p>
        </div>
      </div>

      {smtpUnknown}

      {/* -------- CallRail OTP -------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <CardTitle className="text-lg">Send one CallRail OTP test</CardTitle>
            </div>
            <Badge className={phaseTone(smsState.phase)}>{smsState.phase}</Badge>
          </div>
          <CardDescription>
            Sender (469) 747-2877 → approved test phone. Exactly one SMS, short-lived authorization, one-time consumption.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">Recipient: <code>{APPROVED_TEST_PHONE}</code></div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={smsState.phase === "authorizing"} onClick={() => authorize("sms_otp", APPROVED_TEST_PHONE, null)}>
              {smsState.phase === "authorizing" ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Authorize
            </Button>
            <Button disabled={smsState.phase !== "authorized"} onClick={() => send("sms_otp")}>
              {smsState.phase === "sending" ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm & Send
            </Button>
          </div>
          {smsState.correlationId && (
            <p className="text-xs text-muted-foreground">
              Correlation: <code>{smsState.correlationId}</code>
              {smsState.expiresAt && <> · Expires {new Date(smsState.expiresAt).toLocaleTimeString()}</>}
            </p>
          )}
          {smsState.lastResult && <ResultView data={smsState.lastResult} />}
          {smsState.error && <p className="text-xs text-destructive">{smsState.error}</p>}
        </CardContent>
      </Card>

      {/* -------- Email OTP -------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              <CardTitle className="text-lg">Send one email OTP test</CardTitle>
            </div>
            <Badge className={phaseTone(smtpConfirmed ? emailState.phase : "requires_configuration")}>
              {smtpConfirmed ? emailState.phase : "requires_configuration"}
            </Badge>
          </div>
          <CardDescription>
            Supabase Auth magic-link OTP from BluLadder Secure Access &lt;alerts@admin.bluladder.com&gt;. Not routed through the transactional email pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">Recipient: <code>{APPROVED_TEST_EMAIL}</code></div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!smtpConfirmed || emailState.phase === "authorizing"} onClick={() => authorize("email_otp", APPROVED_TEST_EMAIL, null)}>
              Authorize
            </Button>
            <Button disabled={emailState.phase !== "authorized"} onClick={() => send("email_otp")}>
              Confirm & Send
            </Button>
          </div>
          {emailState.correlationId && (
            <p className="text-xs text-muted-foreground">Correlation: <code>{emailState.correlationId}</code></p>
          )}
          {emailState.lastResult && <ResultView data={emailState.lastResult} />}
          {emailState.error && <p className="text-xs text-destructive">{emailState.error}</p>}
        </CardContent>
      </Card>

      {/* -------- Booking Management Link SMS -------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4" />
              <CardTitle className="text-lg">Send one booking-management-link SMS test</CardTitle>
            </div>
            <Badge className={phaseTone(linkState.phase)}>{linkState.phase}</Badge>
          </div>
          <CardDescription>
            Uses a hidden admin-only test-fixture booking. No Jobber record. Raw management token is never displayed or stored in this UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Fixture booking: {fixtureId ? <code>{fixtureId}</code> : <em>none yet</em>}
          </div>
          {!fixtureId && (
            <Button size="sm" variant="secondary" onClick={ensureFixture}>Create hidden test fixture</Button>
          )}
          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" disabled={!fixtureId || linkState.phase === "authorizing"} onClick={() => authorize("booking_link_sms", APPROVED_TEST_PHONE, fixtureId)}>
              Authorize
            </Button>
            <Button disabled={linkState.phase !== "authorized"} onClick={() => send("booking_link_sms")}>
              Confirm & Send
            </Button>
          </div>
          {linkState.correlationId && (
            <p className="text-xs text-muted-foreground">Correlation: <code>{linkState.correlationId}</code></p>
          )}
          {linkState.lastResult && <ResultView data={linkState.lastResult} />}
          {linkState.error && <p className="text-xs text-destructive">{linkState.error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultView({ data }: { data: Record<string, unknown> }) {
  // Redact anything token-shaped defensively even though the server never returns them.
  const safe = JSON.stringify(data, (_k, v) => {
    if (typeof v === "string" && v.length >= 32 && /^[A-Za-z0-9_-]+$/.test(v)) return "[redacted]";
    return v;
  }, 2);
  return (
    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-52">{safe}</pre>
  );
}
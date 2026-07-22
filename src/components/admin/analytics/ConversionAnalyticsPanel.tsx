import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, RefreshCw, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { aggregateFunnel } from "@/lib/analytics/funnel";
import { OUTCOMES } from "@/lib/analytics/outcomes";
import { toCsv, downloadCsv } from "@/lib/analytics/csvExport";
import {
  loadAnalyticsConfig,
  loadConversionRows,
  type ConversionFilters,
  type LoadedRow,
} from "@/lib/analytics/adminQuery";

// Dimensions we do not yet capture on chat_conversations. These are surfaced
// in the UI as `unknown` and disabled filters, so admins know the gap.
const UNTRACKED_DIMENSIONS = [
  "City",
  "Lead source",
  "Campaign name",
  "New vs existing customer",
  "One-time vs recurring quote",
  "AI model",
  "Prompt/orchestrator version",
];

function pctOrDash(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}
function numOrDash(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function ConversionAnalyticsPanel() {
  const [range, setRange] = useState(defaultRange());
  const [channel, setChannel] = useState<string>("all");
  const [outcome, setOutcome] = useState<string>("all");
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LoadedRow[]>([]);
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([]);
  const [gaps, setGaps] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [inactivity, setInactivity] = useState(60);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const cfg = await loadAnalyticsConfig();
      setInactivity(cfg.inactivity_threshold_minutes);
      const filters: ConversionFilters = {
        start: new Date(`${range.start}T00:00:00Z`),
        end: new Date(`${range.end}T23:59:59Z`),
        channel,
        outcome,
        escalated_only: escalatedOnly,
      };
      const loaded = await loadConversionRows(filters, cfg.inactivity_threshold_minutes);
      setRows(loaded);

      const [reviewsRes, gapsRes] = await Promise.all([
        supabase
          .from("conversation_reviews")
          .select("id, conversation_id, signals, summary, outcome, status, model_version, prompt_version, created_at")
          .gte("created_at", filters.start.toISOString())
          .lt("created_at", filters.end.toISOString())
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("knowledge_gaps")
          .select("id, exact_question, normalized_question, channel, service, conversation_count, status, first_seen_at, last_seen_at, suggested_answer, approved_answer_version")
          .gte("last_seen_at", filters.start.toISOString())
          .order("conversation_count", { ascending: false })
          .limit(500),
      ]);
      if (reviewsRes.error) throw new Error(reviewsRes.error.message);
      if (gapsRes.error) throw new Error(gapsRes.error.message);
      setReviews(reviewsRes.data ?? []);
      setGaps(gapsRes.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const funnel = useMemo(
    () =>
      aggregateFunnel(rows, {
        start: new Date(`${range.start}T00:00:00Z`),
        end: new Date(`${range.end}T23:59:59Z`),
      }),
    [rows, range],
  );

  // Model / prompt comparison — grouped by review-queue-recorded fields.
  // When neither is captured on a row it appears under "unknown".
  const modelGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      model: string;
      prompt: string;
      conversations: number;
      escalations: number;
      turns: number[];
      quoted: number;
      booked: number;
    }>();
    const reviewMap = new Map<string, { model: string; prompt: string }>();
    for (const r of reviews) {
      const cid = r.conversation_id as string;
      reviewMap.set(cid, {
        model: (r.model_version as string | null) ?? "unknown",
        prompt: (r.prompt_version as string | null) ?? "unknown",
      });
    }
    for (const r of rows) {
      const rec = reviewMap.get(r.conversation_id) ?? { model: "unknown", prompt: "unknown" };
      const key = `${rec.model}|${rec.prompt}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          model: rec.model,
          prompt: rec.prompt,
          conversations: 0,
          escalations: 0,
          turns: [],
          quoted: 0,
          booked: 0,
        });
      }
      const g = map.get(key)!;
      g.conversations += 1;
      if (r.human_escalated) g.escalations += 1;
      if (r.turns > 0) g.turns.push(r.turns);
      if (r.first_quote_at) g.quoted += 1;
      if (
        r.outcome.outcome === "booked_automatically" ||
        r.outcome.outcome === "booked_after_human_assistance"
      ) {
        g.booked += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.conversations - a.conversations);
  }, [rows, reviews]);

  function exportConversationsCsv() {
    const csv = toCsv(
      rows.map((r) => ({
        conversation_id: r.conversation_id,
        created_at: r.created_at,
        channel: r.channel,
        outcome: r.outcome.outcome,
        deterministic: r.outcome.deterministic,
        confidence: r.outcome.confidence,
        classifier_version: r.outcome.classifier_version,
        campaign_status: r.campaign_status ?? "unknown",
        service_area_status: r.service_area_status ?? "unknown",
        services: r.services_summary,
        turns: r.turns,
        quote_at: r.first_quote_at ?? "",
        booking_at: r.first_booking_at ?? "",
        human_escalated: r.human_escalated,
        escalation_reason: r.escalation_reason ?? "",
        city: "unknown",
        lead_source: "unknown",
        ai_model: "unknown",
        prompt_version: "unknown",
      })),
    );
    downloadCsv(`conversion-analytics-${range.start}-${range.end}.csv`, csv);
  }

  function exportGapsCsv() {
    const csv = toCsv(gaps as unknown as Record<string, string | number | null>[]);
    downloadCsv(`knowledge-gaps-${range.start}-${range.end}.csv`, csv);
  }

  function exportReviewsCsv() {
    const csv = toCsv(reviews as unknown as Record<string, string | number | null>[]);
    downloadCsv(`review-queue-${range.start}-${range.end}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Conversion Analytics</span>
            <Badge variant="outline" className="text-xs">
              Inactivity threshold: {inactivity} min
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="chat">Website chat</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="voice">Voice (future)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All outcomes</SelectItem>
                  {OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Escalations only</Label>
              <Select value={escalatedOnly ? "yes" : "no"} onValueChange={(v) => setEscalatedOnly(v === "yes")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void refresh()} disabled={loading} size="sm">
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Filters not yet tracked on historical conversations (shown as <em>unknown</em> in exports):{" "}
              {UNTRACKED_DIMENSIONS.join(", ")}.
            </span>
          </div>
          {error && (
            <div className="mt-3 text-sm text-destructive">{error}</div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="gaps">Knowledge gaps</TabsTrigger>
          <TabsTrigger value="models">Model & prompt</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Conversations" value={funnel.counts.new_conversations} />
            <Metric label="Quotes" value={funnel.counts.quotes_produced} />
            <Metric label="Bookings" value={funnel.counts.bookings_completed} />
            <Metric label="Escalations" value={funnel.counts.human_escalations} />
            <Metric label="Conv → Quote" value={pctOrDash(funnel.rates.conversation_to_quote)} />
            <Metric label="Quote → Book" value={pctOrDash(funnel.rates.quote_to_booking)} />
            <Metric label="AI-only book rate" value={pctOrDash(funnel.rates.ai_only_booking_rate)} />
            <Metric label="Median turns" value={numOrDash(funnel.medians.turns)} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={exportConversationsCsv} disabled={rows.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Export conversations CSV
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["New conversations", funnel.counts.new_conversations],
                    ["Qualified leads", funnel.counts.qualified_leads],
                    ["Quotes produced", funnel.counts.quotes_produced],
                    ["Scheduling started", funnel.counts.scheduling_started],
                    ["Slots offered (total)", funnel.counts.slots_offered_total],
                    ["Booking confirmation requested", funnel.counts.booking_confirmation_requested],
                    ["Bookings completed", funnel.counts.bookings_completed],
                    ["Human escalations", funnel.counts.human_escalations],
                    ["Customer drop-offs", funnel.counts.customer_dropoffs],
                  ].map(([label, value]) => (
                    <TableRow key={label as string}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="text-right font-mono">{value as number}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outcomes">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {OUTCOMES.map((o) => (
                    <TableRow key={o}>
                      <TableCell>{o}</TableCell>
                      <TableCell className="text-right font-mono">{funnel.outcomes[o] ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reviews">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                  {reviews.length} review item{reviews.length === 1 ? "" : "s"} in range.
                </p>
                <Button size="sm" variant="outline" onClick={exportReviewsCsv} disabled={reviews.length === 0}>
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.slice(0, 100).map((r) => (
                    <TableRow key={r.id as string}>
                      <TableCell className="text-xs">{new Date(r.created_at as string).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{Array.isArray(r.signals) ? (r.signals as string[]).join(", ") : ""}</TableCell>
                      <TableCell className="text-xs">{(r.outcome as string) ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.status as string}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gaps">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                  {gaps.length} knowledge gap{gaps.length === 1 ? "" : "s"} in range. Approvals happen in the existing knowledge tools.
                </p>
                <Button size="sm" variant="outline" onClick={exportGapsCsv} disabled={gaps.length === 0}>
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Occurrences</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approved v.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gaps.slice(0, 100).map((g) => (
                    <TableRow key={g.id as string}>
                      <TableCell className="text-xs max-w-md truncate">
                        {(g.exact_question as string) || (g.normalized_question as string)}
                      </TableCell>
                      <TableCell className="text-xs">{(g.channel as string) ?? "unknown"}</TableCell>
                      <TableCell className="text-right font-mono">{g.conversation_count as number}</TableCell>
                      <TableCell><Badge variant="outline">{g.status as string}</Badge></TableCell>
                      <TableCell className="text-xs">{(g.approved_answer_version as number | null) ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                Model and prompt version are only known for conversations that entered the review queue with those fields
                recorded. All other conversations appear under <em>unknown</em>. Token counts and AI cost are not stored on
                conversations today, so cost and cost-per-booking are shown as <em>unknown</em> until usage data is captured.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Prompt</TableHead>
                    <TableHead className="text-right">Convs</TableHead>
                    <TableHead className="text-right">Quote rate</TableHead>
                    <TableHead className="text-right">Book rate</TableHead>
                    <TableHead className="text-right">Escalation rate</TableHead>
                    <TableHead className="text-right">Avg turns</TableHead>
                    <TableHead className="text-right">Est. AI cost</TableHead>
                    <TableHead className="text-right">Cost / booking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelGroups.map((g) => {
                    const avgTurns = g.turns.length ? g.turns.reduce((a, b) => a + b, 0) / g.turns.length : null;
                    return (
                      <TableRow key={g.key}>
                        <TableCell className="text-xs">{g.model}</TableCell>
                        <TableCell className="text-xs">{g.prompt}</TableCell>
                        <TableCell className="text-right font-mono">{g.conversations}</TableCell>
                        <TableCell className="text-right font-mono">
                          {g.conversations ? `${((g.quoted / g.conversations) * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {g.conversations ? `${((g.booked / g.conversations) * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {g.conversations ? `${((g.escalations / g.conversations) * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{avgTurns === null ? "—" : avgTurns.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">unknown</TableCell>
                        <TableCell className="text-right text-muted-foreground">unknown</TableCell>
                      </TableRow>
                    );
                  })}
                  {modelGroups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground text-sm">
                        No conversations in range.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
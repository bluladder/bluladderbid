import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Reason =
  | "price_too_high"
  | "chose_another_provider"
  | "timing_wrong"
  | "no_longer_needed"
  | "other";

const REASONS: { value: Reason; label: string }[] = [
  { value: "price_too_high", label: "Price is higher than expected" },
  { value: "chose_another_provider", label: "Going with another provider" },
  { value: "timing_wrong", label: "Timing doesn't work for us" },
  { value: "no_longer_needed", label: "No longer need the service" },
  { value: "other", label: "Something else" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  emailOnFile: string | null;
  resumeToken?: string | null;
  onDeclined?: () => void;
}

export function DeclineQuoteDialog({ open, onOpenChange, quoteId, emailOnFile, resumeToken, onDeclined }: Props) {
  const [reason, setReason] = useState<Reason | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("quote-decline", {
        body: {
          quote_id: quoteId,
          email: emailOnFile,
          resume_token: resumeToken ?? null,
          reason,
          notes: notes.trim() || null,
          source: "customer_quote_view",
        },
      });
      if (fnErr) throw fnErr;
      if (data && typeof data === "object" && "error" in data && (data as any).error) {
        throw new Error(String((data as any).error));
      }
      setDone(true);
      toast.success("Thanks for the feedback — we won't send further reminders.");
      onDeclined?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      toast.error("Could not submit decline. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset when closing after success
      if (done) {
        setReason("");
        setNotes("");
        setDone(false);
        setError(null);
      }
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-background">
        {done ? (
          <>
            <DialogHeader>
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-6 h-6 text-primary" />
              </div>
              <DialogTitle className="text-center">Thanks — we've got it</DialogTitle>
              <DialogDescription className="text-center">
                Your quote is marked declined and we won't send further reminders about it.
                You can always come back to bluladder.com if things change.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button className="w-full" onClick={() => handleClose(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Not moving forward with this bid?</DialogTitle>
              <DialogDescription>
                A quick note helps us improve pricing and follow-ups. No pressure — this stops any
                further messages about this bid.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Reason</Label>
                <RadioGroup
                  value={reason}
                  onValueChange={(v) => setReason(v as Reason)}
                  className="space-y-2"
                >
                  {REASONS.map((r) => (
                    <div key={r.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={r.value} id={`decline-${r.value}`} />
                      <Label htmlFor={`decline-${r.value}`} className="font-normal cursor-pointer">
                        {r.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="decline-notes">Anything else? (optional)</Label>
                <Textarea
                  id="decline-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
                  rows={3}
                  placeholder="Share what would have made this a yes."
                />
                <p className="text-xs text-muted-foreground">{notes.length}/2000</p>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
                Never mind
              </Button>
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={submitting || !reason}
              >
                {submitting ? "Submitting…" : "Decline bid"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DeclineQuoteDialog;
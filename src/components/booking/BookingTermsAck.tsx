import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShieldCheck, FileText, Clock, Sparkles, HeartHandshake } from 'lucide-react';

interface BookingTermsAckProps {
  accepted: boolean;
  onAcceptedChange: (value: boolean) => void;
}

/**
 * Plain-language terms the customer must acknowledge before scheduling.
 * Keeps the legal essentials (pricing subject to change, 30-day validity,
 * pre-existing/fragile item liability) approachable with a little humor.
 */
export function BookingTermsAck({ accepted, onAcceptedChange }: BookingTermsAckProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
        <p>
          A couple of quick, friendly ground rules before we lock it in.{' '}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
              >
                Read the full terms
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  The Fine Print (Made Friendly)
                </DialogTitle>
                <DialogDescription>
                  No lawyer-speak required — here's what you're agreeing to.
                </DialogDescription>
              </DialogHeader>

              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-5 text-sm text-foreground">
                  <section className="space-y-1.5">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Your price is a really good estimate
                    </h3>
                    <p className="text-muted-foreground">
                      We build your quote from the details you give us, so it's accurate as long as
                      reality matches the paperwork. If we show up and discover a surprise — a
                      second-story addition the listing forgot to mention, a heroic amount of mud
                      daubers, or windows that haven't been cleaned since the disco era — we'll talk
                      to you <span className="font-medium text-foreground">before</span> doing any
                      extra work. No mystery charges, ever.
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Clock className="w-4 h-4 text-primary" />
                      This quote is good for 30 days
                    </h3>
                    <p className="text-muted-foreground">
                      Prices hold steady for 30 days from the date of your quote. If life gets busy
                      and you book after that, we may need to refresh the numbers (supplies, fuel, and
                      calendars all like to wander). Booking now keeps today's price locked in.
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <HeartHandshake className="w-4 h-4 text-primary" />
                      Old or fragile things, handled with care
                    </h3>
                    <p className="text-muted-foreground">
                      Our team is highly trained and follows best industry practices — we treat your
                      home like it's our grandma's. That said, we can't be responsible for things that
                      were already cracked, loose, rotted, or wobbly before we arrived, or for
                      genuinely fragile items that give out during normal cleaning. Sometimes a
                      40-year-old screen, a sun-baked seal, or a screw that's been "thinking about it"
                      for a decade finally decides today's the day. We'll always point it out and treat
                      you fairly — but we can't warranty gravity or time.
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h3 className="font-semibold">The short version</h3>
                    <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                      <li>Price is based on the info we have and may change for unforeseen conditions (we'll ask first).</li>
                      <li>Quote is valid for 30 days; after that, pricing may be updated.</li>
                      <li>We're not liable for pre-existing damage or fragile items that fail during normal, careful cleaning.</li>
                      <li>We use trained pros and best practices — but old stuff is still old stuff.</li>
                    </ul>
                  </section>
                </div>
              </ScrollArea>

              <Button onClick={() => setOpen(false)} className="w-full">
                Got it
              </Button>
            </DialogContent>
          </Dialog>
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer group rounded-lg border border-primary/20 bg-primary/5 p-3">
        <Checkbox
          checked={accepted}
          onCheckedChange={(checked) => onAcceptedChange(!!checked)}
          className="mt-0.5"
        />
        <div className="flex-1">
          <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
            I confirm my details are correct and I agree to the terms
          </span>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Pricing is based on the info provided and may change for unforeseen conditions or if
            booked after 30 days. We're not responsible for pre-existing or fragile items that fail
            during normal cleaning.
          </p>
        </div>
        <ShieldCheck className="w-4 h-4 text-success flex-shrink-0" />
      </label>
    </div>
  );
}

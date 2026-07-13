import { MessageSquareText, Mail, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  PHONE_FALLBACK,
  PRIMARY_PUBLIC_PHONE,
  SUPPORT_EMAIL,
} from '@/config/contact';

// SMS help routes to the app/AI transactional number; "call us" shows the
// primary public business number. Both come from the canonical contact config.
const SMS_PHONE = PHONE_FALLBACK.app_ai.e164;

interface BookingHelpContactProps {
  /** Link to the customer's approved bid/quote. Defaults to the current page URL. */
  bidLink?: string;
  /** Optional reference number to include in the message. */
  bidReference?: string;
  /** Optional customer name to personalize the message. */
  customerName?: string;
  /** Headline variant. */
  variant?: 'scheduling' | 'quote';
  className?: string;
}

function buildMessage({
  bidLink,
  bidReference,
  customerName,
}: Pick<BookingHelpContactProps, 'bidLink' | 'bidReference' | 'customerName'>) {
  const link =
    bidLink || (typeof window !== 'undefined' ? window.location.href : '');
  const lines = [
    `Hi BluLadder, this is ${customerName || '[your name]'}.`,
    `I'm having trouble booking my appointment online and could use some help.`,
    bidReference ? `Bid reference: ${bidReference}` : null,
    link ? `My approved bid: ${link}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function BookingHelpContact({
  bidLink,
  bidReference,
  customerName,
  variant = 'scheduling',
  className,
}: BookingHelpContactProps) {
  const message = buildMessage({ bidLink, bidReference, customerName });
  const smsHref = `sms:${SMS_PHONE}?body=${encodeURIComponent(message)}`;
  const mailSubject =
    variant === 'quote'
      ? 'Help with my BluLadder bid'
      : 'Help booking my BluLadder appointment';
  const mailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    mailSubject
  )}&body=${encodeURIComponent(message)}`;

  return (
    <div
      className={
        'rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 ' +
        (className || '')
      }
    >
      <div className="flex items-start gap-2">
        <LifeBuoy className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            {variant === 'quote'
              ? 'Questions about your bid?'
              : 'Need a different time or day?'}
          </p>
          <p className="text-xs text-muted-foreground">
            Having trouble booking online? Text or email us and we'll help you
            find a time that works. Your bid link is included automatically.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="default" size="sm" className="flex-1">
          <a href={smsHref}>
            <MessageSquareText className="mr-1.5 h-4 w-4" />
            Text us
          </a>
        </Button>
        <Button asChild variant="outline" size="sm" className="flex-1">
          <a href={mailHref}>
            <Mail className="mr-1.5 h-4 w-4" />
            Email us
          </a>
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {PRIMARY_PUBLIC_PHONE.display} · {SUPPORT_EMAIL}
      </p>
    </div>
  );
}

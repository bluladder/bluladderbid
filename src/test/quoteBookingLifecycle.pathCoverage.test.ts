import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const quoteBookingView = fs.readFileSync(
  path.resolve(__dirname, "../pages/QuoteBookingView.tsx"),
  "utf8",
);
const bookingFlow = fs.readFileSync(
  path.resolve(__dirname, "../components/booking/BookingFlow.tsx"),
  "utf8",
);
const bookingFunction = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/jobber-create-booking/index.ts",
  ),
  "utf8",
);

describe("accepted quote booking lifecycle", () => {
  it("forwards the exact quote capability and customer-confirmed total", () => {
    expect(quoteBookingView).toMatch(
      /resumedQuote=\{\{ quoteId: quote\.quoteId, resumeToken \}\}/,
    );
    expect(bookingFlow).toMatch(
      /resumedQuoteId\s*=\s*resumedQuote\.quoteId/,
    );
    expect(bookingFlow).toMatch(
      /resumedQuoteToken\s*=\s*resumedQuote\.resumeToken/,
    );
    expect(bookingFlow).toMatch(/confirmedTotal\s*=\s*finalTotal/);
  });

  it("verifies quote scope and lifecycle before provider mutation", () => {
    const verification = bookingFunction.indexOf(
      "await verifyResumeToken(",
    );
    const providerLookup = bookingFunction.indexOf(
      'console.log("Looking up technician:"',
    );
    expect(verification).toBeGreaterThanOrEqual(0);
    expect(providerLookup).toBeGreaterThan(verification);

    const boundary = bookingFunction.slice(verification, providerLookup);
    expect(boundary).toMatch(/isResumedQuoteBookable/);
    expect(boundary).toMatch(/code: "QUOTE_NOT_BOOKABLE"/);
    expect(boundary).toMatch(/status: 409/);
  });

  it("links the exact quote and converts only after local booking persistence", () => {
    expect(bookingFunction).toMatch(
      /const canonicalQuoteId = voiceLineage\?\.ok/,
    );
    expect(bookingFunction).toMatch(
      /\? booking\.voiceContract\?\.quoteId \?\? null\s+: resumedQuote\?\.quoteId \?\? null/,
    );
    expect(bookingFunction).toMatch(/quote_id: canonicalQuoteId/);

    const localBookingInsert = bookingFunction.indexOf(
      "// Create booking record in Supabase",
    );
    const conversion = bookingFunction.indexOf(
      'status: "converted"',
      localBookingInsert,
    );
    expect(localBookingInsert).toBeGreaterThanOrEqual(0);
    expect(conversion).toBeGreaterThan(localBookingInsert);

    const conversionBoundary = bookingFunction.slice(
      conversion,
      bookingFunction.indexOf("const successPayload", conversion),
    );
    expect(conversionBoundary).toMatch(
      /converted_booking_id: bookingRecord\.id/,
    );
    expect(conversionBoundary).toMatch(
      /code: "QUOTE_CONVERSION_RECONCILIATION_REQUIRED"/,
    );
    expect(conversionBoundary).toMatch(/status: 202/);
    expect(conversionBoundary).toMatch(/return new Response/);
  });
});

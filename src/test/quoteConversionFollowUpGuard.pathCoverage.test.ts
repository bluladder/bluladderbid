import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, `../../${relativePath}`), "utf8");

const sweep = read("supabase/functions/_shared/campaignSweep.ts");
const queue = read("supabase/functions/process-sms-queue/index.ts");
const bookingCheck = read(
  "supabase/functions/_shared/lifecycleBookingCheck.ts",
);

describe("quote conversion follow-up guard", () => {
  it("blocks abandonment eligibility on exact durable booking lineage", () => {
    const persistedSweep = sweep.slice(
      sweep.indexOf("runPersistedQuoteAbandonmentSweep"),
    );
    expect(persistedSweep).toMatch(/hasLifecycleBlockingBooking\(supabase/);
    expect(persistedSweep).toMatch(/quoteId:\s*q\.id/);
    expect(persistedSweep).toMatch(/booking_lookup_unavailable/);
    expect(persistedSweep.indexOf("hasLifecycleBlockingBooking")).toBeLessThan(
      persistedSweep.indexOf('eventName: "quote_abandoned"'),
    );
  });

  it("rechecks exact booking lineage immediately before provider delivery", () => {
    expect(queue).toMatch(/hasLifecycleBlockingBooking\(supabase/);
    expect(queue).toMatch(/quoteId:\s*sourceQuoteId/);
    expect(queue).toMatch(/Exact quote booking lineage is already durable/);
    expect(queue).toMatch(/Authoritative booking lineage unavailable/);
  });

  it("makes booking lookup failure explicit rather than returning false", () => {
    expect(bookingCheck).toMatch(/if \(error\)/);
    expect(bookingCheck).toMatch(/throw new Error\(`authoritative booking lookup failed/);
  });
});

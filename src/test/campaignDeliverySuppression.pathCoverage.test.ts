import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const queueSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/process-sms-queue/index.ts",
  ),
  "utf8",
);
const emailSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/_shared/emailConfig.ts",
  ),
  "utf8",
);

describe("campaign delivery suppression integrity", () => {
  it("routes campaign email through the canonical suppression-aware sender", () => {
    expect(queueSource).toMatch(
      /import \{ sendEmail \} from "\.\.\/_shared\/emailConfig\.ts"/,
    );
    expect(queueSource).not.toContain("https://api.resend.com/emails");
    expect(emailSource).toMatch(/await isEmailSuppressed\(normalizedTo\)/);
  });

  it("retries unreadable suppression state without reaching a provider", () => {
    expect(queueSource).toMatch(/if \(suppression\.lookupFailed\)/);
    expect(queueSource).toMatch(/"Suppression state unavailable"/);
    expect(queueSource.indexOf("if (suppression.lookupFailed)")).toBeLessThan(
      queueSource.indexOf("if (msg.channel === \"email\")"),
    );
    expect(queueSource).toMatch(/if \(!pauseEmail\.readable\)/);
    expect(queueSource).toMatch(/if \(!optOut\.readable\)/);
    expect(queueSource).toMatch(/if \(!pauseSms\.readable\)/);
  });

  it("stops before claiming messages when launch controls are unreadable", () => {
    const controlsError = queueSource.indexOf(
      "if (launchControlsError || !launchControls)",
    );
    const claim = queueSource.indexOf(
      'supabase.rpc("claim_due_sms"',
    );
    expect(controlsError).toBeGreaterThanOrEqual(0);
    expect(claim).toBeGreaterThan(controlsError);
    expect(
      queueSource.slice(controlsError, claim),
    ).toMatch(/status: 503/);
  });
});

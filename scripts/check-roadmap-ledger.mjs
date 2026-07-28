import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(root, "docs/ROADMAP_EXECUTION_LEDGER.md");
const errors = [];

if (!fs.existsSync(ledgerPath)) {
  errors.push("missing docs/ROADMAP_EXECUTION_LEDGER.md");
} else {
  const ledger = fs.readFileSync(ledgerPath, "utf8");
  for (
    const required of [
      "Dependency graph",
      "Execution records",
      "Current stage",
      "Protected-action gates",
      "Queued safe stages",
      "Validation ledger",
      "Open architecture decisions",
      "#7",
      "#8",
      "#9",
      "#10",
      "#11",
      "#4",
    ]
  ) {
    if (!ledger.includes(required)) errors.push(`ledger omits ${required}`);
  }
  if (!/Oregon[\s\S]{0,120}inactive/i.test(ledger)) {
    errors.push("ledger must record Oregon as inactive");
  }
  if (
    !ledger.includes("Protected-action gates") ||
    !ledger.includes("hosted migration")
  ) {
    errors.push("ledger must record the hosted migration protected gate");
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "Roadmap ledger OK: dependencies, active stage, gates, and queue recorded.",
);

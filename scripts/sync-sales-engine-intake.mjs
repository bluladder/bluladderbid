import { copyFileSync } from "node:fs";
copyFileSync("packages/sales-engine/intake/quoteIntakeContract.ts", "supabase/functions/_shared/salesEngine/quoteIntakeContract.ts");
copyFileSync("packages/sales-engine/intake/residentialQuoteManifest.ts", "supabase/functions/_shared/salesEngine/residentialQuoteManifest.ts");
copyFileSync("packages/sales-engine/pricing/quoteDisposition.ts", "supabase/functions/_shared/salesEngine/quoteDisposition.ts");
copyFileSync("packages/sales-engine/scheduling/durationContract.ts", "supabase/functions/_shared/salesEngine/durationContract.ts");
console.log("Synchronized Sales Engine intake mirrors.");

import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test(
  "validate-discount-code endpoint consumes shared authoritative validator",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    assertStringIncludes(source, "../_shared/discountCodeValidation.ts");
    assertStringIncludes(source, "validateDiscountCodeAuthoritatively(");
    assertStringIncludes(
      source,
      "createClient(supabaseUrl, supabaseServiceKey)",
    );
  },
);

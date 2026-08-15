import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import {
  createProductionKlamathJobTreadReadRuntime,
} from "../_shared/jobtreadKlamathReadRuntime.ts";
import { createKlamathJobTreadReadHandler } from "./handler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);
const execute = createProductionKlamathJobTreadReadRuntime(supabase);

Deno.serve(createKlamathJobTreadReadHandler({
  async authorize(req) {
    const authorization = await requireAdminOrService(
      req,
      "operations_admin",
    );
    return authorization.ok;
  },
  execute,
}));

// Unit tests for the Phase 6B.2 reservation protection wrappers.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  protectReservationForExecution,
  unprotectReservationAfterFailure,
} from "./reservationProtection.ts";

function stub(rpcResult: any, err: any = null) {
  const calls: any[] = [];
  const supabase = {
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      return { data: rpcResult, error: err };
    },
  };
  return { supabase, calls };
}

Deno.test("protect: forwards result and extends expires_at floor", async () => {
  const { supabase, calls } = stub({ ok: true, updated: 1, total: 1 });
  const at = new Date("2026-07-23T12:00:00Z");
  const r = await protectReservationForExecution(supabase as any, "g1", at);
  assertEquals(r.ok, true);
  assertEquals(calls[0].name, "protect_reservation_for_execution");
  assertEquals(calls[0].args.p_group_id, "g1");
  assertEquals(calls[0].args.p_min_expires_at, at.toISOString());
});

Deno.test("protect: rpc error → ok=false with reason", async () => {
  const { supabase } = stub(null, { message: "boom" });
  const r = await protectReservationForExecution(supabase as any, "g1", new Date());
  assertEquals(r.ok, false);
  assertEquals(r.reason, "boom");
});

Deno.test("unprotect: held target forwarded with default ttl", async () => {
  const { supabase, calls } = stub({ ok: true, updated: 1, new_status: "held" });
  const r = await unprotectReservationAfterFailure(supabase as any, "g1", "held");
  assertEquals(r.ok, true);
  assertEquals(calls[0].args.p_new_status, "held");
  assertEquals(calls[0].args.p_hold_ttl_minutes, 8);
});

Deno.test("unprotect: released target forwarded", async () => {
  const { supabase, calls } = stub({ ok: true, updated: 1, new_status: "released" });
  await unprotectReservationAfterFailure(supabase as any, "g2", "released");
  assertEquals(calls[0].args.p_new_status, "released");
});
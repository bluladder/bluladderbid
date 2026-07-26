import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useActionInboxCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { count: c } = await supabase
        .from("action_inbox_items")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"]);
      if (!cancelled) setCount(c ?? 0);
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  return count;
}
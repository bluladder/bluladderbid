import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateQuote, type QuoteInput } from "../_shared/pricingEngine.ts";
import { loadPricing } from "../_shared/loadPricing.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Maps the AI tool arguments into the canonical engine input shape. The AI
// NEVER computes prices — it only gathers structured inputs and calls the
// deterministic engine below.
function toEngineInput(details: any): QuoteInput {
  const services: string[] = Array.isArray(details.services) ? details.services : [];
  const has = (s: string) => services.includes(s);
  return {
    homeDetails: {
      squareFootage: Number(details.squareFootage),
      stories: Number(details.stories),
      windowCleaningType: "exterior",
      condition: "maintenance",
      showAdvanced: false,
    },
    additionalServices: {
      windowCleaning: has("window_cleaning"),
      houseWash: has("house_wash"),
      gutterCleaning: has("gutter_cleaning"),
      roofCleaning: has("roof_cleaning"),
      roofType: details.roofType || "asphalt",
      roofSeverity: "light",
      drivewayCleaning: {
        enabled: has("driveway_cleaning"),
        sqft: Number(details.drivewaySqft),
        surfaceType: details.drivewaySurface || "concrete",
      },
      pressureWashing: {
        enabled: has("pressure_washing"),
        surfaceType: details.pressureWashSurface || "concrete",
        frontPorch: { enabled: has("pressure_washing"), sqft: Number(details.pressureWashSqft) },
        backPatio: { enabled: false, sqft: 0 },
        poolDeck: { enabled: false, sqft: 0 },
        walkways: { enabled: false, sqft: 0 },
      },
    },
    discount: null,
  };
}

const SYSTEM_PROMPT = `You are BluLadder's friendly quote assistant. You help homeowners get instant price estimates for exterior cleaning services.

Available services: Window Cleaning, House Wash, Gutter Cleaning, Roof Cleaning, Driveway Cleaning, Pressure Washing.

Your job:
1. Greet the customer warmly and ask what services they're interested in
2. Collect their home's approximate square footage and number of stories (1, 2, or 3)
3. Ask about any specific services they want
4. Once you have enough info, use the generate_quote tool to calculate real prices
5. Present the quote clearly with a breakdown, and encourage them to book

Be conversational, friendly, and concise. Don't ask too many questions at once — keep it natural.
If someone seems unsure about their square footage, suggest they estimate or say "most homes are 1,500-3,000 sq ft."
For driveway/pressure washing, also ask about the approximate area in sq ft.

IMPORTANT PRICING RULES (never break these):
- You must NEVER invent, guess, estimate, or state a price from your own knowledge.
- The ONLY source of prices is the generate_quote tool. Call it to get every number you share.
- As soon as you know square footage, stories, and at least one service, call generate_quote.
- If the tool result status is "missing_information", ask the customer only for the listed missing fields, then call generate_quote again.
- If the tool result status is "manual_review_required" or the quote is not firm, tell the customer their job needs a quick manual review and offer to have the team follow up — do NOT present a firm price.
- Only present prices returned by the tool, exactly as returned. Never apply discounts unless the tool applied one.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_quote",
      description: "Calculate a real price quote based on home details and selected services. Call this as soon as you have square footage, stories, and at least one service selected.",
      parameters: {
        type: "object",
        properties: {
          squareFootage: { type: "number", description: "Home square footage" },
          stories: { type: "number", enum: [1, 2, 3], description: "Number of stories" },
          services: {
            type: "array",
            items: { type: "string", enum: ["window_cleaning", "house_wash", "gutter_cleaning", "roof_cleaning", "driveway_cleaning", "pressure_washing"] },
            description: "List of services the customer wants"
          },
          roofType: { type: "string", enum: ["asphalt", "tile", "metal", "flat"], description: "Roof material type if roof cleaning selected" },
          drivewaySqft: { type: "number", description: "Driveway area in sq ft" },
          drivewaySurface: { type: "string", enum: ["concrete", "stamped", "pavers", "brick", "stone", "tile"] },
          pressureWashSqft: { type: "number", description: "Pressure wash area in sq ft" },
          pressureWashSurface: { type: "string", enum: ["concrete", "stamped", "pavers", "brick", "stone", "tile"] },
        },
        required: ["squareFootage", "stories", "services"],
        additionalProperties: false,
      }
    }
  }
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Abuse protection for the public chat endpoint.
    const rl = rateLimit(req, { limit: 30, windowMs: 60000 });
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Too many requests, please slow down." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch pricing config from DB (single source of truth — no fallback prices)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const loaded = await loadPricing(supabase);

    // First AI call
    let response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        tools: TOOLS,
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read the full streaming response to check for tool calls
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let toolCalls: any[] = [];
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) fullContent += delta.content;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        } catch { /* partial JSON */ }
      }
    }

    // If there's a tool call, process it and make a second AI call
    if (toolCalls.length > 0 && toolCalls[0]?.function?.name === "generate_quote") {
      let quoteArgs: any;
      try {
        quoteArgs = JSON.parse(toolCalls[0].function.arguments);
      } catch {
        quoteArgs = {};
      }

      const serviceLabels: Record<string, string> = {
        window_cleaning: "Window Cleaning",
        house_wash: "House Wash",
        gutter_cleaning: "Gutter Cleaning",
        roof_cleaning: "Roof Cleaning",
        driveway_cleaning: "Driveway Cleaning",
        pressure_washing: "Pressure Washing",
      };

      // Authoritative calculation via the canonical engine. If pricing could not
      // be loaded, return a safe manual-review result — never a guessed price.
      const engineResult = !loaded.ok || !loaded.pricing
        ? {
            engineVersion: "unavailable",
            status: "manual_review_required" as const,
            firm: false,
            lineItems: [] as any[],
            subtotal: 0,
            discount: null,
            total: 0,
            missing: [] as string[],
            manualReviewReasons: ["Pricing is temporarily unavailable"],
            explanation: "Pricing is temporarily unavailable, so this needs a manual review.",
          }
        : calculateQuote(toEngineInput(quoteArgs), loaded.pricing, loaded.ruleVersion);

      // Compact result the AI can explain (prices come only from the engine).
      const breakdown: Record<string, number> = {};
      for (const li of engineResult.lineItems) breakdown[li.key] = li.amount;
      const quoteResult = {
        status: engineResult.status,
        firm: engineResult.firm,
        breakdown,
        total: engineResult.total,
        missing: engineResult.missing,
        manualReviewReasons: engineResult.manualReviewReasons,
        explanation: engineResult.explanation,
      };

      // Only persist a quote snapshot when we produced a firm price.
      if (engineResult.firm && engineResult.total > 0) {
        try {
          await supabase.from("quotes").insert({
            home_details_json: { squareFootage: quoteArgs.squareFootage, stories: quoteArgs.stories },
            services_json: engineResult.lineItems.map((li: any) => ({
              service: li.key,
              label: serviceLabels[li.key] || li.label,
              price: li.amount,
            })),
            subtotal: engineResult.subtotal,
            total: engineResult.total,
            session_id: `chat-${Date.now()}`,
            pricing_engine_version: engineResult.engineVersion,
            pricing_rule_version: engineResult.ruleVersion ?? null,
            input_snapshot: toEngineInput(quoteArgs),
            line_item_snapshot: engineResult.lineItems,
          });
        } catch (e) {
          console.error("Failed to save quote:", e);
        }
      }

      // Second AI call with tool result
      const followUpMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
        { role: "assistant", content: null, tool_calls: [{ id: toolCalls[0].id, type: "function", function: { name: "generate_quote", arguments: toolCalls[0].function.arguments } }] },
        { role: "tool", tool_call_id: toolCalls[0].id, content: JSON.stringify(quoteResult) },
      ];

      const followUp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: followUpMessages,
          stream: true,
        }),
      });

      if (!followUp.ok) {
        // Return a non-streamed fallback
        let fallback: string;
        if (quoteResult.firm) {
          const breakdownText = Object.entries(quoteResult.breakdown)
            .map(([k, v]) => `- **${serviceLabels[k] || k}**: $${v}`)
            .join("\n");
          fallback = `Here's your quote!\n\n${breakdownText}\n\n**Total: $${quoteResult.total}**\n\nWould you like to book an appointment?`;
        } else if (quoteResult.status === "missing_information") {
          fallback = `I just need a little more info to price this: ${quoteResult.missing.join(", ")}. Could you share that?`;
        } else {
          fallback = `This job needs a quick manual review from our team, so I can't give a firm price here. Would you like us to follow up with a custom quote?`;
        }
        return new Response(JSON.stringify({ content: fallback, quoteData: quoteResult }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(followUp.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-Quote-Data": JSON.stringify(quoteResult) },
      });
    }

    // No tool call — re-stream the content we already consumed
    if (fullContent) {
      // Create a simple SSE response from the accumulated content
      const encoder = new TextEncoder();
      const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(encoder.encode(sseData), {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(JSON.stringify({ error: "No response generated" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-quote error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

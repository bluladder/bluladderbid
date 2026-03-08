import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Default pricing fallback (matches usePricingConfig defaults)
const DEFAULT_PRICING = {
  window_cleaning: { exteriorPerSqFt: 0.045, interiorPerSqFt: 0.035, minimumPrice: 150, modifiers: { stories: { "1": 0, "2": 25, "3": 50 }, condition: { maintenance: 0, heavy: 40 } } },
  house_wash: { perSqFt: 0.12, minimumPrice: 200, modifiers: { stories: { "1": 0, "2": 30, "3": 60 } }, rustStainSurcharge: 15 },
  gutter_cleaning: { perSqFt: 0.06, minimumPrice: 100, modifiers: { stories: { "1": 0, "2": 25, "3": 50 } } },
  roof_cleaning: { perSqFt: 0.10, minimumPrice: 250, modifiers: { stories: { "1": 0, "2": 20, "3": 40 }, roofType: { asphalt: 0, tile: 25, metal: -10, flat: -15 }, severity: { light: 0, moderate: 25, heavy: 50 } } },
  driveway_cleaning: { perSqFt: 0.50, minimumPrice: 150, surfaceMultipliers: { concrete: 1, stamped: 1.15, pavers: 1.25, brick: 1.20, stone: 1.30, tile: 1.35 } },
  pressure_washing: { perSqFt: 0.40, minimumPrice: 75, surfaceMultipliers: { concrete: 1, stamped: 1.15, pavers: 1.25, brick: 1.20, stone: 1.30, tile: 1.35 } },
};

function applyModifiers(basePrice: number, modifierPercents: number[]): number {
  const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
  return Math.round(basePrice * (1 + totalPercent / 100));
}

function calculateQuote(details: any, pricing: any) {
  const sqft = details.squareFootage || 2000;
  const stories = details.stories || 1;
  const services = details.services || [];
  const results: Record<string, number> = {};
  let total = 0;

  for (const svc of services) {
    let price = 0;
    if (svc === "window_cleaning") {
      const cfg = pricing.window_cleaning;
      const base = sqft * cfg.exteriorPerSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      price = Math.max(Math.round(base * (1 + storyMod / 100)), cfg.minimumPrice);
    } else if (svc === "house_wash") {
      const cfg = pricing.house_wash;
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      price = Math.max(applyModifiers(base, [storyMod]), cfg.minimumPrice);
    } else if (svc === "gutter_cleaning") {
      const cfg = pricing.gutter_cleaning;
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      price = Math.max(applyModifiers(base, [storyMod]), cfg.minimumPrice);
    } else if (svc === "roof_cleaning") {
      const cfg = pricing.roof_cleaning;
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      const typeMod = cfg.modifiers.roofType?.[details.roofType || "asphalt"] ?? 0;
      price = Math.max(applyModifiers(base, [storyMod, typeMod]), cfg.minimumPrice);
    } else if (svc === "driveway_cleaning") {
      const cfg = pricing.driveway_cleaning;
      const dSqft = details.drivewaySqft || 400;
      const surface = details.drivewaySurface || "concrete";
      const mult = cfg.surfaceMultipliers[surface] ?? 1;
      price = Math.max(Math.round(dSqft * cfg.perSqFt * mult), cfg.minimumPrice);
    } else if (svc === "pressure_washing") {
      const cfg = pricing.pressure_washing;
      const pwSqft = details.pressureWashSqft || 200;
      const surface = details.pressureWashSurface || "concrete";
      const mult = cfg.surfaceMultipliers[surface] ?? 1;
      price = Math.max(Math.round(pwSqft * cfg.perSqFt * mult), cfg.minimumPrice);
    }
    results[svc] = price;
    total += price;
  }

  return { breakdown: results, total };
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

IMPORTANT: As soon as you know the square footage, stories, and at least one service, call generate_quote. Don't wait for perfect info.`;

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
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch pricing config from DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let pricing = { ...DEFAULT_PRICING };
    try {
      const { data } = await supabase.from("pricing_config").select("config_key, config_value");
      if (data) {
        for (const row of data) {
          if (row.config_key in pricing) {
            (pricing as any)[row.config_key] = row.config_value;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch pricing, using defaults:", e);
    }

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
        quoteArgs = { squareFootage: 2000, stories: 1, services: ["window_cleaning"] };
      }

      const quoteResult = calculateQuote(quoteArgs, pricing);

      // Save quote to DB
      const serviceLabels: Record<string, string> = {
        window_cleaning: "Window Cleaning",
        house_wash: "House Wash",
        gutter_cleaning: "Gutter Cleaning",
        roof_cleaning: "Roof Cleaning",
        driveway_cleaning: "Driveway Cleaning",
        pressure_washing: "Pressure Washing",
      };

      try {
        await supabase.from("quotes").insert({
          home_details_json: { squareFootage: quoteArgs.squareFootage, stories: quoteArgs.stories },
          services_json: quoteArgs.services.map((s: string) => ({
            service: s,
            label: serviceLabels[s] || s,
            price: quoteResult.breakdown[s] || 0,
          })),
          subtotal: quoteResult.total,
          total: quoteResult.total,
          session_id: `chat-${Date.now()}`,
        });
      } catch (e) {
        console.error("Failed to save quote:", e);
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
        const breakdownText = Object.entries(quoteResult.breakdown)
          .map(([k, v]) => `- **${serviceLabels[k] || k}**: $${v}`)
          .join("\n");
        const fallback = `Here's your quote!\n\n${breakdownText}\n\n**Total: $${quoteResult.total}**\n\nWould you like to book an appointment?`;
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

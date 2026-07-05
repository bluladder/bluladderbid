import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

const APP_URL = "https://bluladderbid.lovable.app";

const SERVICE_KEYS = [
  "window_cleaning",
  "gutter_cleaning",
  "roof_cleaning",
  "house_wash",
  "driveway_cleaning",
  "pressure_washing",
];

export default defineTool({
  name: "get_booking_link",
  title: "Get booking link",
  description:
    "Build a link to BluLadder's online booking / quote flow. Optionally pre-select a service and attach UTM attribution parameters.",
  inputSchema: {
    service: z
      .string()
      .optional()
      .describe(
        "Optional service key to pre-select, e.g. window_cleaning, gutter_cleaning, roof_cleaning, house_wash, driveway_cleaning, pressure_washing.",
      ),
    utm_source: z.string().optional().describe("Optional UTM source for attribution."),
    utm_medium: z.string().optional().describe("Optional UTM medium for attribution."),
    utm_campaign: z.string().optional().describe("Optional UTM campaign for attribution."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ service, utm_source, utm_medium, utm_campaign }) => {
    const url = new URL(APP_URL + "/");
    if (service && SERVICE_KEYS.includes(service)) {
      url.searchParams.set("service", service);
    }
    if (utm_source) url.searchParams.set("utm_source", utm_source);
    if (utm_medium) url.searchParams.set("utm_medium", utm_medium);
    if (utm_campaign) url.searchParams.set("utm_campaign", utm_campaign);

    const link = url.toString();
    return {
      content: [{ type: "text", text: link }],
      structuredContent: { url: link },
    };
  },
});

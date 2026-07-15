import { defineTool } from "@lovable.dev/mcp-js";

const SERVICES = [
  {
    key: "window_cleaning",
    name: "Window Cleaning",
    description:
      "Interior and exterior window cleaning, priced per square foot with story and condition modifiers.",
  },
  {
    key: "gutter_cleaning",
    name: "Gutter Cleaning",
    description:
      "Gutter cleanout with optional underground drain flushing, minor repairs, and micro-mesh gutter guards.",
  },
  {
    key: "roof_cleaning",
    name: "Roof Cleaning",
    description:
      "Soft-wash roof cleaning priced per square foot with roof type and severity modifiers.",
  },
  {
    key: "house_wash",
    name: "House Wash",
    description:
      "Exterior house soft-washing priced per square foot, with a surcharge for rust and irrigation stains.",
  },
  {
    key: "driveway_cleaning",
    name: "Driveway Cleaning",
    description: "Pressure washing for driveways, priced per square foot by surface type.",
  },
  {
    key: "pressure_washing",
    name: "Pressure Washing (Flatwork)",
    description: "Pressure washing for patios, walkways, and other flatwork, priced per square foot.",
  },
  {
    key: "solar_panel_cleaning",
    name: "Solar Panel Cleaning",
    description: "Pure-water solar panel cleaning priced per panel. Restores lost energy output from dust, pollen, and bird droppings.",
  },
  {
    key: "screen_repair",
    name: "Screen Repair",
    description: "On-site window screen re-screening priced per screen. Standard fiberglass mesh; pet-resistant mesh available on request.",
  },
];

export default defineTool({
  name: "list_services",
  title: "List services",
  description:
    "List the home exterior cleaning services BluLadder offers, with a short description of each.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text", text: JSON.stringify(SERVICES, null, 2) }],
    structuredContent: { services: SERVICES },
  }),
});

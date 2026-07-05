import { defineMcp } from "@lovable.dev/mcp-js";
import listServicesTool from "./tools/list-services";
import getPricingInfoTool from "./tools/get-pricing-info";
import getBookingLinkTool from "./tools/get-booking-link";

export default defineMcp({
  name: "bluladder-mcp",
  title: "BluLadder",
  version: "0.1.0",
  instructions:
    "Tools for BluLadder, a home exterior cleaning company (window cleaning, gutters, roof, house wash, pressure washing). Use `list_services` to see what is offered, `get_pricing_info` to explain how pricing works, and `get_booking_link` to send a customer to the online booking/quote flow.",
  tools: [listServicesTool, getPricingInfoTool, getBookingLinkTool],
});

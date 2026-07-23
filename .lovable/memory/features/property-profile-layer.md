---
name: Property Profile Layer
description: Normalized customer↔property↔facts model powering multi-property AI-assisted quoting and autofill
type: feature
---
Customers → many properties (via `customer_properties` join). Each property has typed facts in `property_facts` with provenance and source rank. Current values exposed via `property_facts_current` view. `serviceFactMap.ts` is the ONLY authority on which facts a given service may reuse — never substitute one measurement for another (house sqft ≠ driveway sqft), and prices are always re-run through the pricing engine. Customer/AI-sourced facts NEVER silently overwrite technician/admin/jobber facts; conflicts are logged as needs_review. AI tools: get_resolved_customer_profile, get_customer_properties, select_conversation_property, get_property_profile, get_reusable_quote_inputs, propose_property_fact, confirm_property_fact — all scoped to the conversation's resolved customer, all read-only or bounded to the conversation's own quote_session/property_facts. Backfill: `backfill-property-profiles` edge function (operations_admin, idempotent, ?dry=1) migrates historical quotes/bookings.

# Organization service catalog and pricing — Stage 10A

Stage 10A defines repository-only contracts for organization-owned service
catalogs and versioned pricing. It does not create hosted schema, change the
deployed pricing path, activate a new price, or provision Oregon.

## Contract

Every catalog entry belongs to exactly one organization and identifies whether
the service is standard or custom. Custom services remain drafts until an owner
approves them. Quote and plan availability are independent, and can be enabled,
disabled, or routed to manual review.

Pricing strategies are explicit and ordered. Supported strategy identifiers are
square footage, window count, pane count, manual quote, promotional package, and
hybrid. The resolver selects only from the requested organization, requires one
approved catalog entry, honors an explicitly requested supported strategy, then
uses the first supported configured priority. Missing, duplicate, disabled,
unapproved, or unsupported configurations fail closed to manual review.

Organization pricing profiles are immutable versioned snapshots. A calculation
uses the unique highest approved version for the resolved organization. Missing,
unapproved, or duplicate-current profiles fail closed. The profile carries the
configuration plus organization-specific minimums, labor targets, travel rules,
discounts, tax rules, buffers, and manual-review thresholds. Calculation results
identify the profile and version used so a later persistence layer can record a
complete audit trail.

AI may suggest a custom service, configuration, or price. It is advisory only:
it cannot approve a catalog entry, publish a profile, or bypass manual review.

## Compatibility and inactive fixtures

The DFW compatibility fixture wraps the current `LIVE_CONFIG` and calls the
existing canonical pricing engine unchanged. Its regression test requires the
wrapped quote to equal the legacy quote exactly.

Oregon has no active catalog or pricing profile. Resolution for Oregon cannot
borrow DFW configuration and returns manual review.

## Deferred implementation

Persistence schema, administrative mutation endpoints, generated database
types, deployed runtime adoption, provider configuration, and organization
activation are deferred. They require the hosted tenant migration evidence and
the relevant production authorization phases. There is no DFW fallback for
missing organization identity or pricing configuration.

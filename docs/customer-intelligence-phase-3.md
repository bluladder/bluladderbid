# Organization-scoped customer intelligence — Stage 4A

Stage 4A is a repository-only, pure implementation of explainable customer
features, recommendations, and bounded learning. It creates no schema, imports
no provider data, changes no runtime path, and activates no model.

## Tenant and provenance contract

Every timeline event, feature snapshot, model, candidate, and learning outcome
has mandatory organization lineage. Feature construction rejects a mixed-
organization event set. Scoring rejects a model from another organization.
Learning rejects outcomes from another organization or model. Unknown or
conflicting lineage never defaults to DFW.

Timeline events require a canonical event identifier and explicit value
semantics. Duplicate identifiers fail closed. Service completion counts and
recognized revenue are computed separately, so a service completion followed by
an invoice payment cannot count the same job or value twice.

Feature snapshots carry a feature version and deterministic input fingerprint.
Recommendations carry that fingerprint plus model ID/version, score,
confidence, reason codes, and evidence. This is the minimum provenance required
for later persistence and reproduction; the fingerprint is an identity checksum,
not a security primitive.

## Safety and authority

- Archived Jobber clients are excluded from recommendations and learning using
  an explicit authoritative status supplied by a future organization-scoped
  importer.
- Complaint, damage, refund, legal, and safety events suppress normal sales
  recommendations.
- Only uniquely approved and available services from the resolved
  organization's Stage 10A catalog are eligible.
- Only owner-approved model versions can score.
- Recommendations remain advisory. They cannot book, message, change price, or
  modify owner business rules.
- Weight changes are proposals, bounded per run and globally, and require
  evidence thresholds independently for each organization, model, and feature.

## DFW compatibility and Oregon status

The pure contracts can represent DFW history without changing the existing DFW
runtime. There is no DFW fallback for missing lineage. Oregon has no imported
history, approved model, or active customer-intelligence runtime.

## Deferred stages

Stage 4B may define an additive organization-scoped persistence migration only
after hosted tenant-schema evidence is captured. It must use organization-keyed
uniqueness, composite lineage safeguards, membership RLS, service-role guards,
and draft-only model seeds.

Later stages cover a read-only Jobber importer through the Stage 9A connector
contract, recomputation/persistence APIs, outcome capture, and owner inspection
and activation UI. Hosted migrations, provider calls, backfills, model
activation, and deployed runtime adoption remain protected.

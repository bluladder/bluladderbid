# BluLadder Klamath Phase 0B readiness checklist

Status: **NO-GO for activation**. Phase 0B records and tests the current
second-tenant boundary only. It performs no hosted or provider action.

## Repository checkpoint

- [x] Work starts from the exact verified post-DFW-release `main`.
- [x] Customer-facing naming is BluLadder Klamath.
- [x] PR #81 is preserved, not merged, modified, or treated as current code.
- [x] Klamath/Lake territory and initial service intent are documented.
- [x] JobTread is the only approved Klamath CRM; Jobber fallback is prohibited.
- [x] Klamath pricing requires its own approved profile.
- [x] Inactive territory, unavailable services, missing connectors, missing
      credentials, and conflicting authority fail closed in pure tests.
- [x] Current runtime blockers are captured in a machine-checked register.
- [x] No migration, runtime implementation, provider configuration, contact
      value, credential, customer record, or production flag is added.

## Zero-credit read-only preflight

- [ ] Reconfirm the intended Lovable project and hosted Supabase project without
      exposing identifiers in ordinary evidence.
- [ ] Determine whether Stage 8A organization tables exist and match reviewed
      schema; do not apply or repair migration history.
- [ ] Record only sanitized counts/statuses for active organizations, Klamath
      planning rows, memberships, resolution keys, territories, services, contacts,
      and escalation recipients.
- [ ] Verify background-job definitions, tenant markers, and relevant uniqueness
      classifications without reading credential-bearing commands.
- [ ] Verify JobTread account access and the availability of Grant Key/API and
      webhook controls without creating a key, webhook, customer, job, or task.
- [ ] Verify whether isolated Klamath Vapi assistant/phone resources exist; do
      not create, edit, call, or attach them.
- [ ] Use direct read-only controls first. Do not use Lovable AI or credits for
      an inspection that can be completed without them.

## Required implementation gates

- [ ] Organization-aware hostname/site authority and Klamath link routing.
- [ ] Klamath-owned territory, services, business hours, branding, FAQ, and
      public contact configuration.
- [ ] Independent approved Klamath pricing/catalog profile with no live DFW
      dependency.
- [ ] Tenant-scoped portal identity, customer lookup, quotes, bookings, and
      appointment projection.
- [ ] JobTread capability matrix and adapter for customer/quote synchronization,
      availability, booking create/update/cancel, health, idempotency, and webhooks.
- [ ] Tenant-scoped messaging sender, consent/suppression, durable outbox,
      notifications, and operator alerts.
- [ ] Tenant-safe background jobs, schedule mirrors, caches, campaigns, and
      provider event processing.
- [ ] Required organization/provider uniqueness changes and explicit decisions
      for customer identity, opt-out, testing, and platform-global records.
- [ ] Cross-tenant denial tests for every Klamath customer and provider path.
- [ ] Organization administration/provisioning path or a separately reviewed
      bounded operator runbook while admin surfaces remain disabled.

## Separate release boundaries

1. GitHub implementation PRs, each kept draft until its dependency checks pass.
2. Hosted migration/data authorization while Klamath remains provisioning.
3. Exact-function and frontend deployment authorization with disabled probes.
4. Isolated Vapi provisioning and read-only post-save verification.
5. Owner-controlled quote-link, management-link, FAQ, failure, and transfer
   tests.
6. Explicit owner activation approval only after every gate passes.

## Deferred without blocking a manual-review launch path

- [ ] One-way versus round-trip travel mileage.
- [ ] Per-mile versus flat-fee governance by remote location.
- [ ] Remote route-day optimization.
- [ ] Snow, ice, smoke, and freezing-temperature automation.
- [ ] Spoken canonical pricing.
- [ ] Automated commercial/storefront quoting.

These items are deferrable only when the system enters manual review and does
not quote, book, route, message, or read from DFW on Klamath's behalf.

## Prohibited in Phase 0B

- [x] No merge or auto-merge.
- [x] No deployment or frontend publication.
- [x] No migration authored, applied, repaired, or reconciled.
- [x] No hosted data, schema, RLS, secret, cron, or production-flag mutation.
- [x] No Vapi, JobTread, Jobber, messaging, email, DNS, or other provider change.
- [x] No call, SMS, email, transfer, or assistant tool invocation.
- [x] No Lovable AI message or credit consumption.

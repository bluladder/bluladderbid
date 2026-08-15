# BluLadder Klamath compliance-site activation contract

This repository package prepares read-only gates and one fail-closed migration
for a future, separately authorized compliance-only public-site switch. The
migration is review material only: this package does not apply it and contains
no deployment payload, DNS change, provider change, contact destination, or
hosted mutation.

## Boundary

The future switch may make the Klamath privacy, terms, and reviewed public
contact surfaces reachable. It must not activate quoting, pricing, booking,
messaging, CRM, territory, service, or other customer workflow traffic.

The narrow post-switch database state is:

- the Klamath organization and customer-site lifecycle are active;
- site routing and publication are on;
- `customer_traffic_allowed` remains false;
- the generic hostname resolution key remains disabled;
- exactly one separately approved, verified, published call contact and one
  separately approved, verified, published text contact remain distinct;
- territories, services, pricing, JobTread, and messaging connectors remain
  inactive;
- membership and internal-contact counts remain zero; and
- the DFW legacy default remains exact and unchanged.

The public bootstrap resolves the exact customer site by normalized origin.
Activating the generic hostname resolution key is outside this release and is
not required by this contract.

## Required sequence

1. Merge the reviewed public copy binding, provider-readiness reconciliation,
   and this read-only gate package after exact-head CI and secret scan pass.
2. Obtain exact owner approval and qualified legal review for the final public
   privacy, terms, opt-in, and help copy.
3. Under a separate authorization, insert only the approved call and text
   public contacts, prove reachability, and publish those two rows with durable
   approval evidence.
4. Publish the exact reviewed frontend while the Klamath hostname is still
   disconnected and prove the existing DFW host remains unchanged. This avoids
   exposing an older frontend at the new hostname during DNS setup.
5. Configure the custom domain, DNS, and TLS. The Klamath origin must remain
   unavailable because its lifecycle is still inactive.
6. Run the repository preflight unchanged. All expected counts must match.
7. Under a separate production authorization, review and apply only
   `20260815103000_bluladder_klamath_compliance_site_activation.sql`. It changes
   exactly the Klamath organization and customer-site lifecycle; the migration
   itself rechecks every inactive provider and customer-runtime boundary.
8. Run the repository postflight unchanged, prove the three compliance routes
   from the custom origin, and complete browser acceptance.
9. Submit any Klamath-specific messaging campaign only after its referenced
   public surfaces are live and exact.
10. Treat customer traffic and every provider runtime as separate later
    releases.

Any mismatch fails closed. Do not repair data, infer contact approval, reuse an
unrelated messaging campaign, activate the hostname resolution key, or broaden
the lifecycle change.

The operator must execute the sequence in
`docs/operations/bluladder-klamath-compliance-site-launch-runbook.md` and record
only sanitized evidence in
`docs/operations/bluladder-klamath-compliance-site-launch-evidence.template.json`.
Owner and qualified review must both bind to the immutable candidate identified
by
`docs/operations/bluladder-klamath-compliance-copy-review-manifest.json`; a
mutable branch, screenshot, or URL is not sufficient review evidence.
The completed sanitized launch record must pass
`scripts/validate-bluladder-klamath-compliance-site-launch-evidence.mjs`; the
validator is evidence validation only and does not authorize or perform a
hosted, provider, DNS, frontend, contact, call, or message action.

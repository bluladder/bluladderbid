# BluLadder Klamath compliance-site activation contract

This repository package prepares read-only gates for a future, separately
authorized compliance-only public-site switch. It does not contain a migration,
deployment payload, DNS change, provider change, contact destination, or hosted
mutation.

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
4. Configure the custom domain, DNS, and TLS without exposing customer runtime.
5. Publish the exact reviewed frontend and prove both compliance routes and the
   opt-in/help surface from the custom origin.
6. Run the repository preflight unchanged. All expected counts must match.
7. Only then author and review one narrow lifecycle change that advances the
   organization and customer-site lifecycle described above. That change is
   intentionally absent from this package and requires separate approval.
8. Run the repository postflight unchanged and complete browser acceptance.
9. Submit any Klamath-specific messaging campaign only after its referenced
   public surfaces are live and exact.
10. Treat customer traffic and every provider runtime as separate later
    releases.

Any mismatch fails closed. Do not repair data, infer contact approval, reuse an
unrelated messaging campaign, activate the hostname resolution key, or broaden
the lifecycle change.

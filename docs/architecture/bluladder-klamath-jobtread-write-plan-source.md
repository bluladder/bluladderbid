# BluLadder Klamath JobTread protected write-plan source

Status: **dormant repository contract prepared**. No production entry point
imports this module. It performs no provider request, credential resolution,
operation-attempt write, hosted mutation, deployment, or activation.

## Authority and lifetime

The runner caller supplies only a trusted organization, approved capability,
and opaque internal execution reference. Exactly one server-owned context and
one protected configuration must agree on organization and configuration
version. Contexts expire within five minutes. Protected configuration supplies
the provider organization, exact custom-field bindings, and approved Klamath
services; none can come from a public caller.

## Prepared workflows

- Customer sync creates or updates one customer account, contact, and location
  in order. Each step carries the exact existing parent lineage expected by the
  runner. Already-current state returns no plan.
- Booking creation creates one unpublished JobTread job and then one
  non-notifying scheduled task. Already-complete state returns no plan.
- Booking update changes only the resolved task schedule and approved service
  summary, with dependent/recurring updates and notifications disabled.

Every returned plan is a mutation, but this source never executes it. The
runner still requires a stable idempotency key, atomically claims attempt one,
makes exactly one protected transport call, validates the provider response,
stores only hashes, never automatically retries, and routes ambiguity to read
reconciliation/manual review.

## Remaining gates

Real protected context/configuration adapters, protected field bindings, Grant Key,
inactive connector row, runtime composition, deployment, owner-controlled
provider acceptance, and activation remain separate. There is no webhook,
Jobber fallback, DFW fallback, cancellation automation, invoice handoff, or
provider communications path.

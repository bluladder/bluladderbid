# BluLadder Klamath JobTread server-initiated first wave

Status: **dormant repository contract prepared**. No provider, hosted,
deployment, connector, customer, communication, or activation action is
performed or authorized by this contract.

## Decision

The first Klamath launch does not create or consume a JobTread webhook.
JobTread's intended-account custom-webhook form has no documented signing
secret or custom authentication-header control. An unsigned notification must
not become organization, event, customer, schedule, or mutation authority.

The reviewed first-wave capabilities are already server initiated:

- health verifies the protected Grant Key's organization membership;
- customer sync originates from organization-owned BluLadder state;
- availability is read live from JobTread before booking;
- booking creation and update originate from approved BluLadder operations;
- every provider mutation uses one hashed operation-attempt claim, never
  automatically retries, and requires read reconciliation after ambiguity.

The provider webhook remains disabled, no webhook secret reference is stored,
and no public webhook route is deployed. The authenticated hash-only receipt
store stays dormant for a future provider-supported authentication contract.

## Operational boundary

Provider-initiated changes are manual-review work. Until a future authenticated
change feed is separately approved, an operator must apply the corresponding
change in both systems. Live availability reads remain mandatory so an
unplanned JobTread task can block a conflicting booking even though its payload
was never pushed to BluLadder.

This mode does not make JobTread runtime ready. The organization-scoped Grant
and exact non-sensitive custom-field names now exist, but protected Grant
storage, protected field bindings, an inactive connector row, prepared-plan
persistence, runtime adoption, deployment, owner-controlled acceptance, and
final activation review remain separate gates. No Pave response was received
and no provider read was verified.

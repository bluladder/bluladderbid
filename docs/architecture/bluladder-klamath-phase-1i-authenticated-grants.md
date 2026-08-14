# BluLadder Klamath Phase 1I authenticated grants

Status: **hosted repair applied and independently verified**.

## Observed hosted state

The exact Phase 1I migration was applied once and independently verified. Its
three tables are empty, RLS is enabled, policy counts are exact, anonymous
access is absent, service-role access is complete, DFW authority is unchanged,
and Klamath remains provisioning without customers or provider identities.

Lovable-hosted table creation hydrated all seven table privileges for the
`authenticated` role. That preserved the functional RLS boundary, but it left
`REFERENCES`, `TRIGGER`, and `TRUNCATE` beyond the reviewed connector CRUD
contract, and it left write-shaped table grants on audit ledgers that have only
SELECT policies.

## Forward-only repair

`20260814114500_bluladder_klamath_phase_1i_authenticated_grants.sql` accepts
only the exact observed state before it changes anything. It locks only the
three empty Phase 1I tables, proves exact RLS, policies, grants, DFW authority,
and inactive Klamath state, then narrows:

- `organization_crm_connectors` to `SELECT`, `INSERT`, `UPDATE`, and `DELETE`;
- `organization_connector_operation_attempts` to `SELECT` only;
- `organization_connector_webhook_receipts` to `SELECT` only.

Anonymous denial and all seven `service_role` privileges remain unchanged. The
migration inserts or updates no row, changes no policy, and creates no connector,
provider identity, credential, webhook, runtime path, or activation.

## Verification contract

The read-only preflight reports exact table/RLS/policy state, the observed
seven authenticated privileges per table, zero anonymous grants, twenty-one
service-role grants, empty table counts, exact DFW authority, and inactive
Klamath counts. The read-only postflight requires connector CRUD, audit SELECT,
zero excess authenticated privileges, and every other count unchanged.

The disposable PostgreSQL rehearsal first applies the Phase 1I schema, then
reproduces Lovable's three excess privileges on every target table before
running the exact repair and postflight. Exact-head CI #584 and Secret Scan
#1166 passed on the Git tree merged as
`178776d64484c34d5f289f48dff463a4c86cdf18`.

Lovable applied the repair once as hosted execution version `20260814120308`.
The single stored statement is the 9,900-byte canonical payload without its
terminal line feed; adding that byte reproduces the reviewed 9,901-byte
SHA-256. The ledger advanced from 163 to 164 rows. Independent postflight
proved connector CRUD, audit SELECT, zero excess or anonymous grants, complete
service-role access, exact RLS/policies, zero target rows, unchanged DFW
authority, and provisioning Klamath with no customer or provider state.

JobTread business mappings, connector insertion, credential or webhook setup,
runtime adoption, provider traffic, and customer activation remain separately
blocked.
